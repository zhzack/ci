import io
import tarfile
from pathlib import Path

from fastapi.testclient import TestClient

from mini_pipeline.server.app import create_app
from tests.integration.test_account_machine import authed_settings


def test_installer_scripts_and_package(tmp_path: Path):
    settings = authed_settings(tmp_path)
    app = create_app(settings)
    client = TestClient(app)

    # 1. Test Windows PowerShell Installer with custom server & token
    resp = client.get(
        "/install.ps1?token=mrt_test_token_123&server=http://192.168.1.50:8000"
    )
    assert resp.status_code == 200
    content_ps1 = resp.text
    assert "http://192.168.1.50:8000" in content_ps1
    assert "mrt_test_token_123" in content_ps1
    # Verify idempotent check
    assert "$isInstalled = (Test-Path $Runner) -and (Test-Path $PythonExe)" in content_ps1
    assert "跳过重复环境初始化与依赖安装" in content_ps1
    # Verify background daemon & auto-start setup
    assert "start-runner-background.vbs" in content_ps1
    assert "Startup" in content_ps1

    # 2. Test Linux/macOS Installer with custom server & token
    resp = client.get(
        "/install.sh?token=mrt_test_token_456&server_url=http://10.0.0.1:8000"
    )
    assert resp.status_code == 200
    content_sh = resp.text
    assert "http://10.0.0.1:8000" in content_sh
    assert "mrt_test_token_456" in content_sh
    # Verify idempotent check
    assert "IS_INSTALLED=1" in content_sh
    assert "跳过重复初始化" in content_sh
    # Verify systemd and launchd service registration
    assert "mini-pipeline-runner.service" in content_sh
    assert "com.minipipeline.runner.plist" in content_sh

    # 3. Test Uninstaller endpoints (purge=true vs purge=false)
    resp_un_ps1 = client.get("/uninstall.ps1?purge=true")
    assert resp_un_ps1.status_code == 200
    assert "Stop-Process" in resp_un_ps1.text
    assert "MiniPipelineRunner.vbs" in resp_un_ps1.text
    assert "'true' -eq 'true'" in resp_un_ps1.text

    resp_un_ps1_keep = client.get("/uninstall.ps1?purge=false")
    assert resp_un_ps1_keep.status_code == 200
    assert "'false' -eq 'true'" in resp_un_ps1_keep.text

    resp_un_sh = client.get("/uninstall.sh?purge=true")
    assert resp_un_sh.status_code == 200
    assert "systemctl stop mini-pipeline-runner" in resp_un_sh.text
    assert 'PURGE_ENV="${MINI_PIPELINE_PURGE_ENV:-true}"' in resp_un_sh.text

    resp_un_sh_keep = client.get("/uninstall.sh?purge=false")
    assert resp_un_sh_keep.status_code == 200
    assert 'PURGE_ENV="${MINI_PIPELINE_PURGE_ENV:-false}"' in resp_un_sh_keep.text

    # 4. Test platform tarball package download
    resp_pkg = client.get("/install/package.tar.gz")
    assert resp_pkg.status_code == 200
    assert resp_pkg.headers["content-type"] == "application/gzip"
    with tarfile.open(fileobj=io.BytesIO(resp_pkg.content), mode="r:gz") as tar:
        names = tar.getnames()
        assert "pyproject.toml" in names
        assert any("mini_pipeline/" in name for name in names)
