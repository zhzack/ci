"""Unit tests for storage drivers and package service."""

import io
from pathlib import Path

import pytest

from mini_pipeline.domain.exceptions import ValidationError
from mini_pipeline.storage.local import LocalStorageDriver, is_file_editable


def test_is_file_editable() -> None:
    assert is_file_editable("plugin.yaml") is True
    assert is_file_editable("config.json") is True
    assert is_file_editable("script.sh") is True
    assert is_file_editable("main.py") is True
    assert is_file_editable("README.md") is True
    assert is_file_editable("Dockerfile") is True
    assert is_file_editable("binary.exe") is False
    assert is_file_editable("archive.zip") is False


def test_local_storage_driver_crud(tmp_path: Path) -> None:
    driver = LocalStorageDriver(root=tmp_path)
    assert driver.driver_name == "local"

    # 1. Initially empty
    items = driver.list_dir("")
    assert items == []

    # 2. Create directory
    dir_item = driver.create_dir("plugins/test-plugin")
    assert dir_item.is_dir is True
    assert dir_item.path == "plugins/test-plugin"
    assert (tmp_path / "plugins" / "test-plugin").is_dir()

    # 3. Write text file
    file_item = driver.write_text("plugins/test-plugin/plugin.yaml", "name: test\nversion: 1.0.0\n")
    assert file_item.is_dir is False
    assert file_item.name == "plugin.yaml"
    assert file_item.is_editable is True
    assert file_item.size > 0

    # 4. Read text
    content = driver.read_text("plugins/test-plugin/plugin.yaml")
    assert "version: 1.0.0" in content

    # 5. List sub-directory
    sub_items = driver.list_dir("plugins/test-plugin")
    assert len(sub_items) == 1
    assert sub_items[0].name == "plugin.yaml"
    assert sub_items[0].is_editable is True

    # 6. Write binary file
    bin_stream = io.BytesIO(b"\x00\x01\x02\x03\x04")
    bin_item = driver.write_file("data/binary.dat", bin_stream)
    assert bin_item.size == 5

    # 7. Get stream
    stream, mime, size = driver.get_file_stream("data/binary.dat")
    assert size == 5
    assert stream.read() == b"\x00\x01\x02\x03\x04"
    stream.close()

    # 8. Stat
    stat = driver.stat("plugins/test-plugin/plugin.yaml")
    assert stat is not None
    assert stat.name == "plugin.yaml"

    # 9. Path traversal protection
    with pytest.raises(ValidationError):
        driver.list_dir("../")

    with pytest.raises(ValidationError):
        driver.read_text("foo/../../outside.txt")

    # 10. Delete non-empty dir without recursive flag fails
    with pytest.raises(ValidationError):
        driver.delete("plugins", recursive=False)

    # 11. Delete file and recursive dir
    assert driver.delete("data/binary.dat") is True
    assert driver.stat("data/binary.dat") is None
    assert driver.delete("plugins", recursive=True) is True
    assert driver.stat("plugins") is None


def test_local_storage_driver_dir_size_and_stats(tmp_path: Path) -> None:
    driver = LocalStorageDriver(root=tmp_path)

    # Populate directory structure with various files
    driver.write_text("personal/alice/code/app.py", "print('hello world')\n")
    driver.write_text("personal/alice/docs/readme.md", "# Documentation\n" * 10)
    driver.write_file("shared/dataset.zip", io.BytesIO(b"PK" + b"\x00" * 500))

    # Test folder size calculation
    personal_stat = driver.stat("personal/alice")
    assert personal_stat is not None
    assert personal_stat.is_dir is True
    assert personal_stat.size > 0

    items = driver.list_dir("personal")
    assert len(items) == 1
    assert items[0].name == "alice"
    assert items[0].is_dir is True
    assert items[0].size > 0

    # Test get_stats on root
    stats = driver.get_stats("")
    assert stats.total_size_bytes > 500
    assert stats.total_files == 3
    assert len(stats.zones) >= 2
    assert any(z.zone == "personal" for z in stats.zones)
    assert any(z.zone == "shared" for z in stats.zones)
    assert len(stats.types) >= 2
    assert any(t.category == "archives" for t in stats.types)
    assert any(t.category == "code" for t in stats.types)
    assert len(stats.top_largest) >= 3

    # Test get_stats on subpath
    alice_stats = driver.get_stats("personal/alice")
    assert alice_stats.total_files == 2
    assert alice_stats.total_size_bytes < stats.total_size_bytes

