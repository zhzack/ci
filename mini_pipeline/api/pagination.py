"""Shared list-pagination primitives.

Every list endpoint returns a stable envelope::

    {"items": [...], "total": 123, "page": 1, "page_size": 50, "pages": 3}

``page``/``page_size`` are query parameters validated here so all
collections behave identically and stay cheap even as history grows.
"""

from __future__ import annotations

from typing import Annotated, Generic, TypeVar

from fastapi import Query
from pydantic import BaseModel

T = TypeVar("T")

MAX_PAGE_SIZE = 200
DEFAULT_PAGE_SIZE = 50


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
    pages: int


class PageParams:
    """Dependency that parses and validates `page` and `page_size`."""

    def __init__(
        self,
        page: Annotated[int, Query(ge=1, description="1-based page number")] = 1,
        page_size: Annotated[
            int, Query(ge=1, le=MAX_PAGE_SIZE, description=f"Items per page (max {MAX_PAGE_SIZE})")
        ] = DEFAULT_PAGE_SIZE,
    ) -> None:
        self.page = page
        self.page_size = page_size

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size

    def envelope(self, items: list[T], total: int) -> Page[T]:
        pages = (total + self.page_size - 1) // self.page_size if total else 0
        return Page(
            items=items,
            total=total,
            page=self.page,
            page_size=self.page_size,
            pages=pages,
        )
