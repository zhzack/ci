import io
import zipfile
from pathlib import Path

import pytest

from mini_pipeline.domain.exceptions import SourceError, ValidationError
from mini_pipeline.plugin.manifest import load_manifest
from mini_pipeline.source.archive import ArchiveLimits, extract_zip


def test_manifest_requires_existing_safe_entry(tmp_path: Path) -> None:
    (tmp_path / "plugin.yaml").write_text(
        """
name: hello
version: 1.0.0
runtime: {type: shell}
entry: missing.sh
""",
        encoding="utf-8",
    )

    with pytest.raises(ValidationError, match="entry does not exist"):
        load_manifest(tmp_path)


def test_safe_zip_rejects_path_traversal(tmp_path: Path) -> None:
    archive = tmp_path / "bad.zip"
    with zipfile.ZipFile(archive, "w") as output:
        output.writestr("../outside.txt", "bad")

    with pytest.raises(SourceError, match="Unsafe path"):
        extract_zip(
            archive,
            tmp_path / "extract",
            ArchiveLimits(max_files=10, max_extracted_bytes=1000),
        )

    assert not (tmp_path / "outside.txt").exists()


def test_upload_registration_and_duplicate(client, plugin_zip) -> None:
    archive = plugin_zip()
    response = client.post(
        "/api/plugins/upload",
        files={"file": ("hello.zip", io.BytesIO(archive), "application/zip")},
    )

    assert response.status_code == 201
    assert response.json()["name"] == "hello"
    listing = client.get("/api/plugins")
    assert listing.status_code == 200
    assert listing.json()[0]["version"] == "1.0.0"

    duplicate = client.post(
        "/api/plugins/upload",
        files={"file": ("hello.zip", io.BytesIO(archive), "application/zip")},
    )
    assert duplicate.status_code == 409
