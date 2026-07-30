"""Test that the pre-flight rejects runs whose required params are not filled
either by pipeline-level params or by the run request body.
"""
import io
import zipfile


def build_plugin_with_required(name: str) -> bytes:
    manifest = (
        f"name: {name}\n"
        f"version: 1.0.0\n"
        f"description: t\n"
        f"runtime: {{type: shell}}\n"
        f"entry: run.sh\n"
        f"inputs:\n"
        f"  greeting:\n"
        f"    type: string\n"
        f"    required: true\n"
        f"outputs: {{}}\n"
    )
    script = "#!/bin/sh\nexit 0\n"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as archive:
        archive.writestr("plugin.yaml", manifest)
        info = zipfile.ZipInfo("run.sh")
        info.external_attr = 0o755 << 16
        archive.writestr(info, script)
    return buf.getvalue()


def test_run_rejected_when_required_param_missing(client, tmp_path) -> None:
    archive = build_plugin_with_required("req")
    response = client.post(
        "/api/plugins/upload",
        files={"file": ("req.zip", io.BytesIO(archive), "application/zip")},
    )
    assert response.status_code == 201

    definition = """
name: needs-greeting
params: {}
steps:
  - name: greet
    plugin: req@1.0.0
    with:
      greeting: "${{ params.greeting }}"
"""
    create = client.post("/api/pipelines", json={"definition": definition})
    assert create.status_code == 201

    # No params supplied → pre-flight should reject
    submitted = client.post(
        "/api/runs",
        json={"pipeline": "needs-greeting", "params": {}},
    )
    assert submitted.status_code == 422, submitted.text
    assert "greeting" in submitted.text


def test_run_accepted_when_required_param_provided(client) -> None:
    archive = build_plugin_with_required("req")
    response = client.post(
        "/api/plugins/upload",
        files={"file": ("req.zip", io.BytesIO(archive), "application/zip")},
    )
    assert response.status_code == 201

    definition = """
name: needs-greeting
params: {}
steps:
  - name: greet
    plugin: req@1.0.0
    with:
      greeting: "${{ params.greeting }}"
"""
    create = client.post("/api/pipelines", json={"definition": definition})
    assert create.status_code == 201

    submitted = client.post(
        "/api/runs",
        json={"pipeline": "needs-greeting", "params": {"greeting": "hi"}},
    )
    assert submitted.status_code == 202, submitted.text
