"""Secret params: declaration, masking and runtime injection.

A pipeline parameter whose definition contains ``secret: true`` must be
supplied by the run request. Its value is stored outside the visible params
payload (runs.params carries "******"), never returned by any API, and
reaches the plugin only through ``MP_SECRET_<NAME>`` environment variables.
"""

from __future__ import annotations

import io
import json
import time
import zipfile

from fastapi.testclient import TestClient

from mini_pipeline.pipeline.schema import secret_param_names, split_secret_params
from mini_pipeline.server.app import create_app
from tests.integration.test_platform_features import (
    build_settings,
)


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_secret_param_helpers() -> None:
    definition = {
        "api_key": {"secret": True, "description": "third-party key"},
        "region": "cn-north-1",
        "plain": {"type": "string"},
    }
    assert secret_param_names(definition) == {"api_key"}

    masked, real = split_secret_params(definition, {"api_key": "s3cr3t", "region": "eu"})
    assert masked == {"api_key": "******", "region": "eu"}
    assert real == {"api_key": "s3cr3t"}

    # No secret declarations: payload passes through untouched.
    masked, real = split_secret_params({"region": "eu"}, {"region": "eu"})
    assert masked == {"region": "eu"} and real == {}


SECRET_PLUGIN = """name: secret-echo
version: 1.0.0
runtime:
  type: python
  entry: run.py
"""


def _secret_echo_plugin() -> bytes:
    run_py = (
        "import json, os\n"
        "print(json.dumps({\n"
        "    'env_secret': os.environ.get('MP_SECRET_API_KEY'),\n"
        "}))\n"
        "inp = json.load(open('input.json', encoding='utf-8'))\n"
        "print(json.dumps({'payload_api_key': inp.get('params', {}).get('api_key')}))\n"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("plugin.yaml", SECRET_PLUGIN)
        zf.writestr("run.py", run_py)
    return buf.getvalue()


def _setup(client: TestClient) -> dict:
    client.post("/api/auth/register", json={"username": "root", "password": "password-123"})
    r = client.post("/api/auth/register", json={"username": "alice", "password": "password-123"})
    token = r.json()["token"]
    headers = auth_headers(token)
    plugin = client.post(
        "/api/plugins/upload",
        files={"file": ("secret-echo.zip", io.BytesIO(_secret_echo_plugin()), "application/zip")},
        headers=headers,
    )
    assert plugin.status_code == 201, plugin.text
    definition = (
        "name: secret-demo\n"
        "params:\n"
        "  api_key:\n"
        "    secret: true\n"
        "  region: cn-north-1\n"
        "steps:\n"
        "  - {name: go, plugin: secret-echo@1.0.0}\n"
    )
    created = client.post("/api/pipelines", json={"definition": definition}, headers=headers)
    assert created.status_code == 201, created.text
    return {"token": token, "headers": headers}


def test_secret_param_required_and_masked(tmp_path) -> None:
    settings = build_settings(
        tmp_path, auth={"enabled": True, "registration_enabled": True},
        security={"secret_key": "unit-test-secret-key"},
    )
    with TestClient(create_app(settings)) as client:
        ctx = _setup(client)
        headers = ctx["headers"]

        # 1. Missing secret param is rejected at submit time.
        missing = client.post(
            "/api/runs", json={"pipeline": "secret-demo", "params": {}}, headers=headers,
        )
        assert missing.status_code == 422, missing.text
        assert "api_key" in missing.text

        # 2. Submit with the secret value.
        ok = client.post(
            "/api/runs",
            json={"pipeline": "secret-demo", "params": {"api_key": "s3cr3t-value"}},
            headers=headers,
        )
        assert ok.status_code == 202, ok.text
        run_id = ok.json()["id"]

        # 3. Wait for terminal status.
        deadline = time.monotonic() + 15
        run = {}
        while time.monotonic() < deadline:
            run = client.get(f"/api/runs/{run_id}", headers=headers).json()
            if run.get("status") in {"SUCCESS", "FAILED"}:
                break
            time.sleep(0.1)
        assert run.get("status") == "SUCCESS", run

        # 4. API payload carries the mask, never the real value.
        assert run["params"]["api_key"] == "******"
        assert "s3cr3t-value" not in json.dumps(run)

        # 5. The plugin received the real value via env var; params.json held
        #    only the mask.
        log = client.get(
            f"/api/runs/{run_id}/tasks/go/log", headers=headers,
        ).text
        assert "s3cr3t-value" in log, log
        assert '"payload_api_key": "******"' in log, log
