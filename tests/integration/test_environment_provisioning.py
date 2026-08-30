"""Integration tests for Runtime Environment management,
package distribution, and remote deployment.
"""

from __future__ import annotations

import time
from pathlib import Path

from fastapi.testclient import TestClient

from mini_pipeline.server.app import create_app
from tests.integration.test_account_machine import (
    auth_headers,
    authed_settings,
    register_user,
)


def test_environment_crud_and_deploy_workflow(tmp_path: Path) -> None:
    settings = authed_settings(tmp_path)
    app = create_app(settings)

    with TestClient(app) as client:
        # 1. Bootstrap admin
        admin = register_user(client, "admin")
        h_admin = auth_headers(admin["token"])

        # 2. Verify seeded default environments
        res_list = client.get("/api/environments", headers=h_admin)
        assert res_list.status_code == 200
        envs = res_list.json()
        assert len(envs) >= 3
        default_py = next((e for e in envs if e["name"] == "python-3.10-standalone"), None)
        assert default_py is not None
        assert default_py["env_type"] == "python"
        assert default_py["version"] == "3.10.14"

        # 3. Create a custom environment
        res_create = client.post(
            "/api/environments",
            json={
                "name": "python-3.12-custom",
                "env_type": "python",
                "version": "3.12.3",
                "os_arch": "linux-x86_64",
                "package_path": "environments/python-3.12.3-linux-x86_64.tar.gz",
                "description": "Python 3.12 最新版运行时环境",
                "is_default": False,
            },
            headers=h_admin,
        )
        assert res_create.status_code == 201
        custom_env = res_create.json()
        assert custom_env["name"] == "python-3.12-custom"

        # 4. Register a target machine
        res_machine = client.post(
            "/api/machines",
            json={
                "name": "Worker Node 01",
                "connection_type": "agent",
            },
            headers=h_admin,
        )
        assert res_machine.status_code == 201
        machine = res_machine.json()["machine"]

        # 5. Batch deploy environment to the machine
        res_deploy = client.post(
            f"/api/environments/{custom_env['id']}/deploy",
            json={"machine_ids": [machine["id"]]},
            headers=h_admin,
        )
        assert res_deploy.status_code == 200
        tasks = res_deploy.json()
        assert len(tasks) == 1
        task_id = tasks[0]["id"]
        assert tasks[0]["machine_id"] == machine["id"]
        assert tasks[0]["environment_name"] == "python-3.12-custom"

        # 6. Wait for asynchronous deployment pipeline to complete
        max_wait = 10
        start = time.time()
        final_task = None
        while time.time() - start < max_wait:
            res_task = client.get(f"/api/environments/deploy-tasks/{task_id}", headers=h_admin)
            assert res_task.status_code == 200
            task_data = res_task.json()
            if task_data["status"] in ("success", "failed"):
                final_task = task_data
                break
            time.sleep(0.5)

        assert final_task is not None
        assert final_task["status"] == "success"
        assert final_task["progress"] == 100
        assert "部署成功" in final_task["logs"]

        # 7. Check list deploy tasks
        res_all_tasks = client.get("/api/environments/deploy-tasks", headers=h_admin)
        assert res_all_tasks.status_code == 200
        assert any(t["id"] == task_id for t in res_all_tasks.json())

        # 8. Test /install.sh generation contains auto-healing script logic
        res_install = client.get("/install.sh?token=mrt_test_token")
        assert res_install.status_code == 200
        sh_text = res_install.text
        assert "mrt_test_token" in sh_text
        assert "python-standalone" in sh_text
        assert "apt-get install -y python3-venv" in sh_text
