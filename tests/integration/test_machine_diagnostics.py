"""Integration tests for Machine Diagnostics, Telemetry, Process Monitor,
Directory Explorer, In-place File Editor, Batch Zip Download, and Remote Shell Console.
"""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from mini_pipeline.server.app import create_app
from tests.integration.test_account_machine import (
    auth_headers,
    authed_settings,
    register_user,
)


def test_machine_diagnostics_and_file_ops_workflow(tmp_path: Path) -> None:
    settings = authed_settings(tmp_path)
    app = create_app(settings)

    with TestClient(app) as client:
        # 1. Register admin user
        admin = register_user(client, "admin")
        h_admin = auth_headers(admin["token"])

        # 2. Register a machine
        res_machine = client.post(
            "/api/machines",
            json={"name": "Dev Host 01", "connection_type": "agent"},
            headers=h_admin,
        )
        assert res_machine.status_code == 201
        machine = res_machine.json()["machine"]
        machine_id = machine["id"]

        # 3. Query system overview
        res_overview = client.get(
            f"/api/machines/{machine_id}/diagnostics/overview",
            headers=h_admin,
        )
        assert res_overview.status_code == 200
        overview = res_overview.json()
        assert "cpu_percent" in overview
        assert "memory_percent" in overview
        assert "disk_total_gb" in overview
        assert "hostname" in overview

        # 4. Query processes (Task manager full list)
        res_procs = client.get(
            f"/api/machines/{machine_id}/diagnostics/processes",
            headers=h_admin,
        )
        assert res_procs.status_code == 200
        procs = res_procs.json()
        assert isinstance(procs, list)
        assert len(procs) > 0

        # 4.1 Query comprehensive network diagnostics
        res_net = client.get(
            f"/api/machines/{machine_id}/diagnostics/network",
            headers=h_admin,
        )
        assert res_net.status_code == 200
        net_data = res_net.json()
        assert "interfaces" in net_data
        assert "connections" in net_data
        assert isinstance(net_data["interfaces"], list)
        assert isinstance(net_data["connections"], list)

        # 5. File Operations: Upload file
        demo_file_path = str(tmp_path / "hello.txt").replace("\\", "/")
        res_upload = client.post(
            f"/api/machines/{machine_id}/diagnostics/files/upload",
            data={"target_dir": str(tmp_path)},
            files={"file": ("hello.txt", b"Hello from Antigravity Runner", "text/plain")},
            headers=h_admin,
        )
        assert res_upload.status_code == 200

        # 6. File Operations: List directory
        res_files = client.get(
            f"/api/machines/{machine_id}/diagnostics/files",
            params={"path": str(tmp_path)},
            headers=h_admin,
        )
        assert res_files.status_code == 200
        files = res_files.json()
        assert any(f["name"] == "hello.txt" for f in files)

        # 7. File Operations: Read file content
        res_content = client.get(
            f"/api/machines/{machine_id}/diagnostics/files/content",
            params={"path": demo_file_path},
            headers=h_admin,
        )
        assert res_content.status_code == 200
        content_data = res_content.json()
        assert content_data["is_text"] is True
        assert "Hello from Antigravity Runner" in content_data["content"]

        # 8. File Operations: Save edited file content
        res_save = client.put(
            f"/api/machines/{machine_id}/diagnostics/files/content",
            json={"path": demo_file_path, "content": "Updated content: v2 active"},
            headers=h_admin,
        )
        assert res_save.status_code == 200

        # Verify saved content
        res_content2 = client.get(
            f"/api/machines/{machine_id}/diagnostics/files/content",
            params={"path": demo_file_path},
            headers=h_admin,
        )
        assert res_content2.json()["content"] == "Updated content: v2 active"

        # 9. File Operations: Download files as ZIP
        res_zip = client.get(
            f"/api/machines/{machine_id}/diagnostics/files/download",
            params={"paths": [demo_file_path, str(tmp_path)]},
            headers=h_admin,
        )
        assert res_zip.status_code == 200
        assert res_zip.headers["content-type"] == "application/zip"
        with zipfile.ZipFile(io.BytesIO(res_zip.content), "r") as zf:
            assert "hello.txt" in zf.namelist()

        # 10. Execute command with directory sync (cd)
        res_exec = client.post(
            f"/api/machines/{machine_id}/diagnostics/exec",
            json={"command": "cd ~", "working_dir": str(tmp_path)},
            headers=h_admin,
        )
        assert res_exec.status_code == 200
        exec_data = res_exec.json()
        assert exec_data["exit_code"] == 0
        assert exec_data["new_working_dir"] is not None

        # 11. File Operations: Batch delete
        res_del = client.post(
            f"/api/machines/{machine_id}/diagnostics/files/batch-delete",
            json={"paths": [demo_file_path]},
            headers=h_admin,
        )
        assert res_del.status_code == 200
        assert not Path(demo_file_path).exists()

        # 12. Access control validation
        res_unauth = client.get(f"/api/machines/{machine_id}/diagnostics/overview")
        assert res_unauth.status_code == 401
