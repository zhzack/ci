import io
import tarfile
from pathlib import Path
from typing import Union

import pytest

from mini_pipeline.core.config import SourceConfig
from mini_pipeline.domain.exceptions import SourceError
from mini_pipeline.plugin.manifest import load_manifest
from mini_pipeline.source.archive import ArchiveLimits
from mini_pipeline.source.toolhub import ToolhubSource, extract_tar_gz


def _make_tar(payload: dict[str, Union[str, bytes]], base: Path) -> Path:
    """Build a tar.gz from {relpath: content}; bytes are treated as raw mode-0755 files."""
    archive = base / "tool.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        info = tarfile.TarInfo("plugin.yaml")
        plugin_yaml = (
            b"name: demo\n"
            b"version: 1.0.0\n"
            b"runtime:\n"
            b"  type: shell\n"
            b"  entry: run.sh\n"
            b"toolhub:\n"
            b"  env: {}\n"
        )
        info.size = len(plugin_yaml)
        tar.addfile(info, io.BytesIO(plugin_yaml))
        for name, content in payload.items():
            data = content.encode() if isinstance(content, str) else content
            entry = tarfile.TarInfo(name)
            entry.size = len(data)
            entry.mode = 0o755
            tar.addfile(entry, io.BytesIO(data))
    return archive


def test_extract_tar_gz_populates_plugin_root(tmp_path: Path) -> None:
    archive = _make_tar({"run.sh": "#!/bin/sh\necho hi\n"}, tmp_path)
    dest = tmp_path / "out"
    stream = io.BytesIO(archive.read_bytes())

    root = extract_tar_gz(
        stream,
        dest,
        ArchiveLimits(max_files=10, max_extracted_bytes=10000),
    )

    assert (root / "run.sh").exists()
    manifest = load_manifest(root)
    assert manifest.name == "demo"
    assert manifest.runtime.type == "shell"


def test_extract_tar_gz_rejects_path_traversal(tmp_path: Path) -> None:
    archive = tmp_path / "bad.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        data = b"bad"
        entry = tarfile.TarInfo("../outside.txt")
        entry.size = len(data)
        tar.addfile(entry, io.BytesIO(data))

    with pytest.raises(SourceError, match="Unsafe path"):
        extract_tar_gz(
            io.BytesIO(archive.read_bytes()),
            tmp_path / "extract",
            ArchiveLimits(max_files=10, max_extracted_bytes=10000),
        )
    assert not (tmp_path / "outside.txt").exists()


def test_resolve_latest_and_pinned(tmp_path: Path) -> None:
    source = ToolhubSource(SourceConfig())
    index = {
        "tools": {
            "sync": {
                "runtime": "python",
                "entry": "sync.py",
                "channels": {
                    "stable": [
                        {"version": "v0.9.0", "artifact": "sync/stable/v0.9.0/a.tar.gz"},
                        {"version": "v1.0.0", "artifact": "sync/stable/v1.0.0/b.tar.gz"},
                    ],
                    "testing": [
                        {
                            "version": "v1.1.0-beta.1",
                            "artifact": "sync/testing/v1.1.0-beta.1/c.tar.gz",
                        }
                    ],
                },
            }
        }
    }

    latest = source._resolve(index, "sync", "stable", "")
    assert latest["version"] == "v0.9.0"

    pinned = source._resolve(index, "sync", "stable", "v1.0.0")
    assert pinned["artifact"].endswith("v1.0.0/b.tar.gz")

    testing = source._resolve(index, "sync", "testing", "")
    assert testing["version"] == "v1.1.0-beta.1"


def test_resolve_missing_tool_raises(tmp_path: Path) -> None:
    source = ToolhubSource(SourceConfig())
    with pytest.raises(SourceError, match="not found"):
        source._resolve({"tools": {}}, "missing", "stable", "")