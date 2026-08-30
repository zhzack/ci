"""Integration tests for package repository API and workflows."""

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


def _build_test_plugin_zip() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        manifest = (
            "name: test-pkg-plugin\n"
            "version: 1.0.0\n"
            "description: Test plugin from packages\n"
            "runtime:\n"
            "  type: shell\n"
            "  entry: run.sh\n"
        )
        zf.writestr("plugin.yaml", manifest)
        zf.writestr("run.sh", "#!/bin/bash\necho hello from package\n")
    return buf.getvalue()


def test_packages_api_lifecycle(tmp_path: Path) -> None:
    settings = authed_settings(tmp_path)
    app = create_app(settings)

    with TestClient(app) as client:
        admin = register_user(client, "admin")
        h = auth_headers(admin["token"])

        # 1. Initially empty
        res = client.get("/api/packages", headers=h)
        assert res.status_code == 200, res.text
        data = res.json()
        assert data["driver"] == "local"
        assert data["current_path"] == ""
        item_names = [i["name"] for i in data["items"]]
        assert "shared" in item_names and "personal" in item_names

        # 2. Create directory
        res = client.post("/api/packages/mkdir", json={"path": "", "name": "configs"}, headers=h)
        assert res.status_code == 200, res.text
        assert res.json()["name"] == "configs"
        assert res.json()["is_dir"] is True

        # 3. Upload file to configs/
        file_content = b"app:\n  port: 8080\n  env: staging\n"
        files = {"file": ("app.yaml", io.BytesIO(file_content), "application/x-yaml")}
        res = client.post(
            "/api/packages/upload", data={"target_dir": "configs"}, files=files, headers=h
        )
        assert res.status_code == 200, res.text
        assert res.json()["name"] == "app.yaml"
        assert res.json()["path"] == "configs/app.yaml"
        assert res.json()["is_editable"] is True

        # 4. List configs/ directory
        res = client.get("/api/packages", params={"path": "configs"}, headers=h)
        assert res.status_code == 200
        sub_data = res.json()
        assert sub_data["parent_path"] == ""
        assert len(sub_data["items"]) == 1
        assert sub_data["items"][0]["name"] == "app.yaml"

        # 5. Preview file
        res = client.get("/api/packages/preview", params={"path": "configs/app.yaml"}, headers=h)
        assert res.status_code == 200
        preview = res.json()
        assert preview["is_text"] is True
        assert "port: 8080" in preview["content"]
        assert preview["is_editable"] is True

        # 6. Save modified text
        updated_content = "app:\n  port: 9000\n  env: production\n"
        payload = {"path": "configs/app.yaml", "content": updated_content}
        res = client.put("/api/packages/file", json=payload, headers=h)
        assert res.status_code == 200

        # 7. Download file and verify modification
        res = client.get("/api/packages/download", params={"path": "configs/app.yaml"}, headers=h)
        assert res.status_code == 200
        assert "port: 9000" in res.text
        assert "attachment" in res.headers.get("content-disposition", "")

        # 8. Delete file and directory
        res = client.delete("/api/packages", params={"path": "configs/app.yaml"}, headers=h)
        assert res.status_code == 200
        assert res.json()["success"] is True

        res = client.delete("/api/packages", params={"path": "configs"}, headers=h)
        assert res.status_code == 200
        assert res.json()["success"] is True


def test_packages_publish_plugin(tmp_path: Path) -> None:
    settings = authed_settings(tmp_path)
    app = create_app(settings)

    with TestClient(app) as client:
        admin = register_user(client, "admin")
        h = auth_headers(admin["token"])

        # Upload plugin zip archive
        zip_bytes = _build_test_plugin_zip()
        files = {"file": ("test-plugin.zip", io.BytesIO(zip_bytes), "application/zip")}
        res = client.post("/api/packages/upload", files=files, headers=h)
        assert res.status_code == 200
        pkg_item = res.json()
        assert pkg_item["name"] == "test-plugin.zip"

        # Call publish-plugin endpoint
        res = client.post(
            "/api/packages/publish-plugin", json={"path": "test-plugin.zip"}, headers=h
        )
        assert res.status_code == 200, res.text
        plugin = res.json()
        assert plugin["name"] == "test-pkg-plugin"
        assert plugin["version"] == "1.0.0"

        # Verify it now exists in /api/plugins
        res = client.get("/api/plugins", headers=h)
        assert res.status_code == 200
        names = [p["name"] for p in res.json()["items"]]
        assert "test-pkg-plugin" in names


def test_packages_folder_upload_and_extract(tmp_path: Path) -> None:
    settings = authed_settings(tmp_path)
    app = create_app(settings)

    with TestClient(app) as client:
        admin = register_user(client, "admin")
        h = auth_headers(admin["token"])

        # 1. Upload file with relative_path (preserving folder structure)
        code = b"print('nested hello')\n"
        files = {"file": ("module.py", io.BytesIO(code), "text/x-python")}
        res = client.post(
            "/api/packages/upload",
            data={"target_dir": "custom_plugin", "relative_path": "src/utils/module.py"},
            files=files,
            headers=h,
        )
        assert res.status_code == 200, res.text
        item = res.json()
        assert item["path"] == "custom_plugin/src/utils/module.py"

        # 2. Preview nested file
        res = client.get(
            "/api/packages/preview",
            params={"path": "custom_plugin/src/utils/module.py"},
            headers=h,
        )
        assert res.status_code == 200
        assert "nested hello" in res.json()["content"]

        # 3. Upload zip and test extract archive endpoint
        zip_bytes = _build_test_plugin_zip()
        files = {"file": ("archive.zip", io.BytesIO(zip_bytes), "application/zip")}
        res = client.post("/api/packages/upload", files=files, headers=h)
        assert res.status_code == 200

        # Extract archive
        res = client.post(
            "/api/packages/extract",
            json={"path": "archive.zip", "target_dir": "extracted_plugin"},
            headers=h,
        )
        assert res.status_code == 200, res.text
        dir_item = res.json()
        assert dir_item["is_dir"] is True

        # Check extracted files
        res = client.get("/api/packages", params={"path": "extracted_plugin"}, headers=h)
        assert res.status_code == 200
        items = [i["name"] for i in res.json()["items"]]
        assert "plugin.yaml" in items
        assert "run.sh" in items


def test_artifact_publish_to_packages(tmp_path: Path) -> None:
    settings = authed_settings(tmp_path)
    app = create_app(settings)

    with TestClient(app) as client:
        admin = register_user(client, "admin")
        h = auth_headers(admin["token"])

        # Insert a simulated artifact
        artifact_dir = tmp_path / "artifacts"
        artifact_dir.mkdir(parents=True, exist_ok=True)
        artifact_file = artifact_dir / "build_output.tar.gz"
        artifact_file.write_bytes(b"sample build artifact data")

        from mini_pipeline.database.models import Artifact, PipelineDefinition, PipelineRun, TaskRun
        services = app.state.services
        with services.database.session() as s:
            pipe = PipelineDefinition(
                name="test-art-pipe",
                definition="name: test-art-pipe\nsteps: []\n",
                owner_id=admin["user"]["id"],
            )
            s.add(pipe)
            s.flush()
            run = PipelineRun(
                pipeline_id=pipe.id,
                pipeline_name=pipe.name,
                status="COMPLETED",
                owner_id=admin["user"]["id"],
            )
            s.add(run)
            s.flush()
            task = TaskRun(
                run_id=run.id,
                step_name="build",
                position=0,
                plugin_name="builder",
                plugin_version="1.0.0",
                status="COMPLETED",
            )
            s.add(task)
            s.flush()
            art = Artifact(
                run_id=run.id,
                task_id=task.id,
                name="build_output.tar.gz",
                storage_path=str(artifact_file),
                size=len(b"sample build artifact data"),
                sha256="dummy",
            )
            s.add(art)
            s.commit()
            art_id = art.id

        # 2. Call publish-to-packages
        res = client.post(
            f"/api/artifacts/{art_id}/publish-to-packages",
            json={"target_dir": "releases/v1"},
            headers=h,
        )
        assert res.status_code == 200, res.text
        pkg_item = res.json()
        assert pkg_item["path"] == "releases/v1/build_output.tar.gz"

        # 3. Verify it is accessible in package store
        res = client.get("/api/packages", params={"path": "releases/v1"}, headers=h)
        assert res.status_code == 200
        items = [i["name"] for i in res.json()["items"]]
        assert "build_output.tar.gz" in items

        # 4. Copy/import this package into another folder (e.g. users/bob/imported.tar.gz)
        copy_res = client.post(
            "/api/packages/copy",
            json={
                "src_path": "releases/v1/build_output.tar.gz",
                "dst_path": "users/bob/imported.tar.gz",
            },
            headers=h,
        )
        assert copy_res.status_code == 200, copy_res.text
        copied_item = copy_res.json()
        assert copied_item["path"] == "users/bob/imported.tar.gz"

        res = client.get("/api/packages", params={"path": "users/bob"}, headers=h)
        assert res.status_code == 200
        items = [i["name"] for i in res.json()["items"]]
        assert "imported.tar.gz" in items


def test_packages_share_links_and_zones(tmp_path: Path) -> None:
    settings = authed_settings(tmp_path)
    app = create_app(settings)

    with TestClient(app) as client:
        _ = register_user(client, "admin")
        alice = register_user(client, "alice")
        bob = register_user(client, "bob")

        h_alice = auth_headers(alice["token"])
        h_bob = auth_headers(bob["token"])

        # 1. Alice creates personal file
        res = client.put(
            "/api/packages/file",
            json={"path": "personal/alice/model_config.txt", "content": "weights_v1_data"},
            headers=h_alice,
        )
        assert res.status_code == 200, res.text

        # 2. Bob cannot access Alice's personal zone
        res = client.get("/api/packages", params={"path": "personal/alice"}, headers=h_bob)
        assert res.status_code == 403

        # 3. Alice creates a Live Share link
        res = client.post(
            "/api/packages/share",
            json={
                "source_path": "personal/alice/model_config.txt",
                "share_type": "live",
                "description": "Alice's live model weights",
            },
            headers=h_alice,
        )
        assert res.status_code == 200, res.text
        live_share = res.json()
        assert live_share["share_type"] == "live"
        live_token = live_share["token"]

        # 4. Bob downloads through share link (no auth required for public token download)
        dl_res = client.get(f"/api/packages/shared/{live_token}/download")
        assert dl_res.status_code == 200
        assert dl_res.text == "weights_v1_data"

        # 5. Bob imports Live share to his personal zone
        import_res = client.post(
            f"/api/packages/shared/{live_token}/import",
            json={"target_path": "personal/bob/linked_config"},
            headers=h_bob,
        )
        assert import_res.status_code == 200, import_res.text
        assert import_res.json()["path"] == "personal/bob/linked_config.link.json"

        # 6. Alice creates a Snapshot share link
        res = client.post(
            "/api/packages/share",
            json={
                "source_path": "personal/alice/model_config.txt",
                "share_type": "snapshot",
                "description": "Snapshot v1",
            },
            headers=h_alice,
        )
        assert res.status_code == 200
        snap_share = res.json()
        snap_token = snap_share["token"]

        # 7. Bob imports Snapshot share into his personal space as independent file
        import_snap_res = client.post(
            f"/api/packages/shared/{snap_token}/import",
            json={"target_path": "personal/bob/config_copy.txt"},
            headers=h_bob,
        )
        assert import_snap_res.status_code == 200
        assert import_snap_res.json()["path"] == "personal/bob/config_copy.txt"

        # Verify Bob can read his copied file
        res = client.get(
            "/api/packages/preview",
            params={"path": "personal/bob/config_copy.txt"},
            headers=h_bob,
        )
        assert res.status_code == 200
        assert res.json()["content"] == "weights_v1_data"

        # 8. Alice lists her active shares
        res = client.get("/api/packages/shares", headers=h_alice)
        assert res.status_code == 200
        shares = res.json()
        assert len(shares) == 2

        # 9. Alice revokes the live share link
        res = client.delete(f"/api/packages/shares/{live_token}", headers=h_alice)
        assert res.status_code == 200

        # 10. Subsequent access to revoked token fails
        res = client.get(f"/api/packages/shared/{live_token}/download")
        assert res.status_code == 404


def test_packages_storage_stats_api(tmp_path: Path) -> None:
    settings = authed_settings(tmp_path)
    app = create_app(settings)

    with TestClient(app) as client:
        admin = register_user(client, "admin")
        h_admin = auth_headers(admin["token"])

        # Upload files in shared & personal
        client.post(
            "/api/packages/upload",
            files={"file": ("notes.txt", b"some documentation", "text/plain")},
            data={"target_dir": "shared"},
            headers=h_admin,
        )
        client.post(
            "/api/packages/upload",
            files={"file": ("archive.zip", b"PK\x00\x00" * 50, "application/zip")},
            data={"target_dir": "shared/archives"},
            headers=h_admin,
        )

        # 1. Admin gets stats for entire root
        res = client.get("/api/packages/stats", headers=h_admin)
        assert res.status_code == 200, res.text
        stats = res.json()
        assert stats["total_size_bytes"] > 0
        assert stats["total_files"] >= 2
        assert len(stats["types"]) >= 1
        assert len(stats["top_largest"]) >= 2

        # 2. Query stats for specific sub-directory
        res_sub = client.get("/api/packages/stats", params={"path": "shared"}, headers=h_admin)
        assert res_sub.status_code == 200
        sub_stats = res_sub.json()
        assert sub_stats["scope_path"] == "shared"
        assert sub_stats["total_files"] >= 2


def test_packages_batch_operations_api(tmp_path: Path) -> None:
    settings = authed_settings(tmp_path)
    app = create_app(settings)

    with TestClient(app) as client:
        admin = register_user(client, "admin")
        h_admin = auth_headers(admin["token"])

        # 1. Upload multiple test files
        client.post(
            "/api/packages/upload",
            files={"file": ("file1.txt", b"content 1", "text/plain")},
            data={"target_dir": "shared"},
            headers=h_admin,
        )
        client.post(
            "/api/packages/upload",
            files={"file": ("file2.txt", b"content 222", "text/plain")},
            data={"target_dir": "shared"},
            headers=h_admin,
        )

        # 2. Test Batch Download (ZIP)
        res_dl = client.post(
            "/api/packages/batch-download",
            json={"paths": ["shared/file1.txt", "shared/file2.txt"]},
            headers=h_admin,
        )
        assert res_dl.status_code == 200
        assert res_dl.headers["content-type"] == "application/zip"
        assert len(res_dl.content) > 0

        # 3. Test Batch Copy
        res_copy = client.post(
            "/api/packages/batch-copy",
            json={
                "src_paths": ["shared/file1.txt", "shared/file2.txt"],
                "dst_dir": "shared/copied",
            },
            headers=h_admin,
        )
        assert res_copy.status_code == 200
        assert res_copy.json()["copied_count"] == 2

        # Verify copied items exist
        res_list = client.get("/api/packages", params={"path": "shared/copied"}, headers=h_admin)
        assert res_list.status_code == 200
        items = res_list.json()["items"]
        assert len(items) == 2

        # 4. Test Batch Delete
        res_del = client.post(
            "/api/packages/batch-delete",
            json={"paths": ["shared/copied/file1.txt", "shared/copied/file2.txt"]},
            headers=h_admin,
        )
        assert res_del.status_code == 200
        assert res_del.json()["deleted_count"] == 2

        # Verify items are gone
        res_list2 = client.get("/api/packages", params={"path": "shared/copied"}, headers=h_admin)
        assert res_list2.status_code == 200
        assert len(res_list2.json()["items"]) == 0





