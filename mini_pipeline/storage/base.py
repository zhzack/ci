"""Base models and abstract storage driver interface."""

from abc import ABC, abstractmethod
from datetime import datetime
from typing import BinaryIO, Optional

from pydantic import BaseModel, Field


class StorageItem(BaseModel):
    name: str
    path: str
    is_dir: bool
    size: int = 0
    mime_type: Optional[str] = None
    updated_at: Optional[datetime] = None
    extension: str = ""
    is_editable: bool = False
    is_plugin_candidate: bool = False


class DirectoryListing(BaseModel):
    driver: str
    current_path: str
    parent_path: Optional[str] = None
    items: list[StorageItem] = Field(default_factory=list)


class FilePreview(BaseModel):
    name: str
    path: str
    size: int
    mime_type: str
    is_text: bool
    content: Optional[str] = None
    line_count: int = 0
    is_editable: bool = False
    updated_at: Optional[datetime] = None


class ZoneUsage(BaseModel):
    zone: str
    name: str
    size_bytes: int = 0
    file_count: int = 0
    dir_count: int = 0
    percentage: float = 0.0


class TypeUsage(BaseModel):
    category: str
    label: str
    color: str
    size_bytes: int = 0
    file_count: int = 0
    percentage: float = 0.0


class StorageLeaderboardItem(BaseModel):
    name: str
    path: str
    is_dir: bool
    size_bytes: int = 0
    updated_at: Optional[datetime] = None


class StorageStats(BaseModel):
    scope_path: str
    total_size_bytes: int = 0
    total_files: int = 0
    total_dirs: int = 0
    zones: list[ZoneUsage] = Field(default_factory=list)
    types: list[TypeUsage] = Field(default_factory=list)
    top_largest: list[StorageLeaderboardItem] = Field(default_factory=list)


class StorageDriver(ABC):
    """Abstract storage driver for artifact/package persistence."""

    @property
    @abstractmethod
    def driver_name(self) -> str:
        """Name of the storage driver (e.g. 'local', 's3')."""

    @abstractmethod
    def list_dir(self, path: str = "") -> list[StorageItem]:
        """List contents of a directory."""

    @abstractmethod
    def get_file_stream(self, path: str) -> tuple[BinaryIO, str, int]:
        """Return (stream, content_type, size_bytes) for reading a file."""

    @abstractmethod
    def read_text(self, path: str, max_chars: int = 2_000_000) -> str:
        """Read file as text content."""

    @abstractmethod
    def write_file(self, path: str, stream: BinaryIO) -> StorageItem:
        """Write stream content to the specified path."""

    @abstractmethod
    def write_text(self, path: str, text: str) -> StorageItem:
        """Write string content to the specified text file."""

    @abstractmethod
    def create_dir(self, path: str) -> StorageItem:
        """Create a directory at path."""

    @abstractmethod
    def delete(self, path: str, recursive: bool = False) -> bool:
        """Delete a file or directory."""

    @abstractmethod
    def stat(self, path: str) -> Optional[StorageItem]:
        """Get metadata for a file or directory."""

    @abstractmethod
    def get_real_path_if_local(self, path: str) -> Optional[str]:
        """Return local filesystem path if available, or None for remote object store."""

    @abstractmethod
    def get_stats(self, path: str = "") -> StorageStats:
        """Calculate storage space analytics and breakdown for given scope path."""
