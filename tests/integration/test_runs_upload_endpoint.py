import io
import json
import tarfile
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient


def setup_test_pipeline(client: TestClient):
    plugin_src = Path("examples/plugins/local-package-tool").resolve()
    plugin_zip_buf = io.BytesIO()
    with zipfile.ZipFile(plugin_zip_buf, "w") as z:
        for f in plugin_src.rglob("*"):
            if f.is_file():
                z.write(f, arcname=f.relative_to(plugin_src))
    plugin_zip_buf.seek(0)

    reg_resp = client.post(
        "/api/plugins/upload",
        files={"file": ("local-package-tool.zip", plugin_zip_buf, "application/zip")},
    )
    assert reg_resp.status_code in (200, 201), f"Plugin registration failed: {reg_resp.text}"

    pipeline_yaml = """
name: test-upload-pipeline
steps:
  - name: build-pkg
    plugin: local-package-tool@1.0.0
    with:
      full_package_name: "${{ params.full_package_name }}"
      im_package:
        source: upload
      m_package:
        source: upload
"""
    resp = client.post("/api/pipelines", json={
        "definition": pipeline_yaml,
    })
    assert resp.status_code in (200, 201), f"Pipeline creation failed: {resp.text}"


def test_submit_run_with_uploads_api(client: TestClient):
    setup_test_pipeline(client)

    mock_im = io.BytesIO()
    with tarfile.open(fileobj=mock_im, mode="w:gz") as tar:
        ti = tarfile.TarInfo(name="app/im/.version")
        data = b"IM_V1.0"
        ti.size = len(data)
        tar.addfile(ti, io.BytesIO(data))
    mock_im.seek(0)

    mock_m = io.BytesIO()
    with tarfile.open(fileobj=mock_m, mode="w:gz") as tar:
        ti = tarfile.TarInfo(name="m/.version")
        data = b"M_V1.0"
        ti.size = len(data)
        tar.addfile(ti, io.BytesIO(data))
    mock_m.seek(0)

    files = [
        ("im_package", ("Lccar_IPD_SW071.tar.gz", mock_im, "application/gzip")),
        ("m_package", ("DJINS_OrinX.tar.gz", mock_m, "application/gzip")),
    ]
    data = {
        "pipeline": "test-upload-pipeline",
        "params_json": json.dumps({"full_package_name": "API_Test_Upload_Pkg"}),
    }

    upload_resp = client.post("/api/runs/upload", data=data, files=files)
    assert upload_resp.status_code == 202, f"Upload run failed: {upload_resp.text}"
    run_data = upload_resp.json()
    assert "id" in run_data
    assert run_data["pipeline_name"] == "test-upload-pipeline"
    assert "im_package" in run_data.get("uploads", {})


def test_rerun_inherits_uploads(client: TestClient):
    setup_test_pipeline(client)

    mock_im = io.BytesIO()
    with tarfile.open(fileobj=mock_im, mode="w:gz") as tar:
        ti = tarfile.TarInfo(name="app/im/.version")
        data = b"IM_V1.0"
        ti.size = len(data)
        tar.addfile(ti, io.BytesIO(data))
    mock_im.seek(0)

    mock_m = io.BytesIO()
    with tarfile.open(fileobj=mock_m, mode="w:gz") as tar:
        ti = tarfile.TarInfo(name="m/.version")
        data = b"M_V1.0"
        ti.size = len(data)
        tar.addfile(ti, io.BytesIO(data))
    mock_m.seek(0)

    files = [
        ("im_package", ("Lccar_IPD_SW071.tar.gz", mock_im, "application/gzip")),
        ("m_package", ("DJINS_OrinX.tar.gz", mock_m, "application/gzip")),
    ]
    data = {
        "pipeline": "test-upload-pipeline",
        "params_json": json.dumps({"full_package_name": "API_Test_Upload_Pkg"}),
    }
    upload_resp = client.post("/api/runs/upload", data=data, files=files)
    assert upload_resp.status_code == 202
    first_run = upload_resp.json()
    first_run_id = first_run["id"]
    assert "im_package" in first_run.get("uploads", {})

    # 触发快速重跑 (Fast Re-run)
    rerun_resp = client.post("/api/runs", json={
        "pipeline": "test-upload-pipeline",
        "params": {"full_package_name": "API_Test_Upload_Pkg_Rerun"},
        "parent_run_id": first_run_id,
        "reuse_uploads": True,
    })
    assert rerun_resp.status_code == 202, f"Rerun failed: {rerun_resp.text}"
    second_run = rerun_resp.json()
    assert second_run["id"] != first_run_id
    assert "im_package" in second_run.get("uploads", {})
