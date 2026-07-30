"""FastAPI dependency accessors."""

from fastapi import Request

from mini_pipeline.core.container import Services


def get_services(request: Request) -> Services:
    return request.app.state.services
