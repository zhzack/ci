"""Debug endpoints for inspecting pipeline state without CLI access."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from mini_pipeline.api.dependencies import get_services
from mini_pipeline.core.config import load_settings
from mini_pipeline.core.container import Services

router = APIRouter(prefix="/debug", tags=["debug"])


class PipelineSummary(BaseModel):
    id: str
    name: str
    created_at: str
    updated_at: str


class RunSummary(BaseModel):
    id: str
    pipeline_id: str
    pipeline_name: str
    status: str
    created_at: str
    started_at: Optional[str]
    finished_at: Optional[str]
    message: Optional[str]
    parent_run_id: Optional[str]
    branched_from_step: Optional[str]


class TaskSummary(BaseModel):
    name: str
    plugin: str
    status: str
    message: Optional[str]
    outputs: dict[str, Any]


class PluginSummary(BaseModel):
    name: str
    version: str
    description: str
    source_type: str
    runtime_type: str
    entry: str


def _connect() -> sqlite3.Connection:
    settings = load_settings()
    url = settings.database.url
    if not url.startswith("sqlite"):
        raise HTTPException(status_code=400, detail="Debug endpoints support SQLite only")
    return sqlite3.connect(url.replace("sqlite:///", ""))


@router.get("/pipelines", response_model=list[PipelineSummary])
def list_pipelines() -> list[dict[str, Any]]:
    conn = _connect()
    try:
        conn.row_factory = sqlite3.Row
        return [dict(r) for r in conn.execute(
            "SELECT id, name, created_at, updated_at FROM pipeline_definitions ORDER BY updated_at DESC"
        )]
    finally:
        conn.close()


@router.get("/pipelines/{pipeline_id}")
def pipeline_detail(pipeline_id: str) -> dict[str, Any]:
    conn = _connect()
    try:
        conn.row_factory = sqlite3.Row
        pipeline = conn.execute(
            "SELECT * FROM pipeline_definitions WHERE id = ? OR name = ?",
            (pipeline_id, pipeline_id),
        ).fetchone()
        if not pipeline:
            raise HTTPException(status_code=404, detail=f"Pipeline {pipeline_id!r} not found")
        result = dict(pipeline)
        # Include the most recent run for context
        latest_run = conn.execute(
            "SELECT * FROM pipeline_runs WHERE pipeline_id = ? ORDER BY created_at DESC LIMIT 1",
            (result["id"],),
        ).fetchone()
        result["latest_run"] = dict(latest_run) if latest_run else None
        return result
    finally:
        conn.close()


@router.get("/runs", response_model=list[RunSummary])
def list_runs(pipeline: Optional[str] = None, limit: int = 20) -> list[dict[str, Any]]:
    conn = _connect()
    try:
        conn.row_factory = sqlite3.Row
        if pipeline:
            rows = conn.execute(
                "SELECT * FROM pipeline_runs WHERE pipeline_name = ? "
                "OR pipeline_id = ? ORDER BY created_at DESC LIMIT ?",
                (pipeline, pipeline, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM pipeline_runs ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@router.get("/runs/{run_id}")
def run_detail(run_id: str) -> dict[str, Any]:
    conn = _connect()
    try:
        conn.row_factory = sqlite3.Row
        run = conn.execute(
            "SELECT * FROM pipeline_runs WHERE id = ?", (run_id,)
        ).fetchone()
        if not run:
            raise HTTPException(status_code=404, detail=f"Run {run_id!r} not found")
        result = dict(run)
        tasks = conn.execute(
            "SELECT * FROM task_runs WHERE run_id = ? ORDER BY position",
            (run_id,),
        ).fetchall()
        task_list = []
        for t in tasks:
            td = dict(t)
            if td.get("outputs"):
                try:
                    td["outputs"] = json.loads(td["outputs"])
                except Exception:
                    pass
            artifacts = conn.execute(
                "SELECT id, name, size, sha256 FROM artifacts WHERE task_id = ?",
                (td["id"],),
            ).fetchall()
            td["artifacts"] = [dict(a) for a in artifacts]
            task_list.append(td)
        result["tasks"] = task_list
        return result
    finally:
        conn.close()


@router.get("/plugins", response_model=list[PluginSummary])
def list_plugins() -> list[dict[str, Any]]:
    conn = _connect()
    try:
        conn.row_factory = sqlite3.Row
        return [dict(r) for r in conn.execute(
            "SELECT name, version, description, source_type, runtime_type, entry "
            "FROM plugin_versions ORDER BY name, version"
        )]
    finally:
        conn.close()


@router.get("/filesystem")
def filesystem_summary() -> dict[str, Any]:
    settings = load_settings()
    root = Path(settings.storage.root).resolve()
    out: dict[str, Any] = {"root": str(root)}
    for sub in ("plugins", "workspaces", "logs", "artifacts", "tmp"):
        path = root / sub
        out[sub] = {
            "path": str(path),
            "exists": path.exists(),
            "size_bytes": sum(f.stat().st_size for f in path.rglob("*") if f.is_file()) if path.exists() else 0,
            "file_count": sum(1 for _ in path.rglob("*") if _.is_file()) if path.exists() else 0,
        }
    return out


@router.get("/on-disk/{plugin_name}")
def on_disk_plugin(plugin_name: str, version: Optional[str] = None) -> dict[str, Any]:
    settings = load_settings()
    base = Path(settings.storage.plugins) / plugin_name
    if not base.exists():
        raise HTTPException(status_code=404, detail=f"No plugin {plugin_name!r} on disk")
    versions = sorted(p.name for p in base.iterdir() if p.is_dir())
    if version and version not in versions:
        raise HTTPException(status_code=404, detail=f"Version {version!r} not found")
    target = base / version if version else base / versions[-1]
    files = []
    for p in target.rglob("*"):
        if p.is_file():
            files.append({
                "path": str(p.relative_to(target)),
                "size": p.stat().st_size,
            })
    manifest = (target / "plugin.yaml").read_text(encoding="utf-8")
    return {
        "plugin": plugin_name,
        "version": target.name,
        "path": str(target),
        "files": files,
        "plugin_yaml": manifest,
    }
