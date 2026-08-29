import io
import sys
from pathlib import Path

import pytest

from mini_pipeline.core.config import SourceConfig
from mini_pipeline.source.upload import FolderFile, UploadSource


def _build_demo_folder() -> list[FolderFile]:
    return [
        FolderFile(
            path="plugin.yaml",
            content=(
                b"name: folder-plugin\n"
                b"version: 1.0.0\n"
                b"description: from folder\n"
                b"runtime: {type: shell}\n"
                b"entry: run.sh\n"
            ),
            is_dir=False,
        ),
        FolderFile(
            path="run.sh",
            content=b"#!/bin/sh\nset -eu\nprintf '{\"status\":\"success\"}' > output.json\n",
            is_dir=False,
            mode=0o755,
        ),
        FolderFile(
            path="src/notes.txt",
            content=b"folder upload works\n",
            is_dir=False,
        ),
    ]


def _settings() -> SourceConfig:
    return SourceConfig(
        http_timeout_seconds=1,
        max_archive_bytes=1024 * 1024,
        max_archive_files=100,
        max_extracted_bytes=1024 * 1024,
    )


def test_folder_upload_rejects_unsafe_paths() -> None:
    source = UploadSource(_settings())
    with pytest.raises(Exception, match="Unsafe path"):
        source._normalize_folder(
            [FolderFile(path="../escape.txt", content=b"x", is_dir=False)]
        )


@pytest.mark.skipif(
    sys.platform == "win32",
    reason="Windows filesystems do not preserve POSIX exec bits",
)
def test_folder_upload_extraction_creates_workspace(tmp_path: Path) -> None:
    source = UploadSource(_settings())
    destination = tmp_path / "dest"
    result = source.fetch_folder(_build_demo_folder(), destination)
    assert (result / "plugin.yaml").is_file()
    assert (result / "run.sh").is_file()
    assert (result / "src" / "notes.txt").is_file()
    mode = (result / "run.sh").stat().st_mode & 0o777
    assert mode == 0o755


def test_register_folder_via_api(client) -> None:
    boundary = "----MiniPipelineFolder"
    files = _build_demo_folder()
    body = io.BytesIO()
    for entry in files:
        body.write(f"--{boundary}\r\n".encode())
        body.write(
            (
                f'Content-Disposition: form-data; name="files"; filename="{entry.path}"\r\n'
                f"Content-Type: application/octet-stream\r\n\r\n"
            ).encode()
        )
        body.write(entry.content)
        body.write(b"\r\n")
    body.write(f"--{boundary}--\r\n".encode())
    payload = body.getvalue()

    response = client.post(
        "/api/plugins/upload-folder",
        content=payload,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )

    assert response.status_code == 201, response.text
    body_json = response.json()
    assert body_json["name"] == "folder-plugin"
    assert body_json["version"] == "1.0.0"

    listing = client.get("/api/plugins")
    names = [item["name"] for item in listing.json()["items"]]
    assert "folder-plugin" in names
