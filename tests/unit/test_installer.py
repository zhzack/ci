import io
import tarfile

from fastapi.testclient import TestClient

from mini_pipeline.server.app import app


def test_install_sh_endpoint():
    client = TestClient(app)
    res = client.get("/install.sh")
    assert res.status_code == 200
    assert "text/x-shellscript" in res.headers.get("content-type", "")
    assert "Mini Pipeline runner installer (Linux/macOS)" in res.text
    assert "curl -fsSL" in res.text


def test_install_sh_with_token():
    client = TestClient(app)
    res = client.get("/install.sh?token=mrt_test_token_123")
    assert res.status_code == 200
    assert 'TOKEN="${MINI_PIPELINE_TOKEN:-mrt_test_token_123}"' in res.text


def test_install_ps1_endpoint():
    client = TestClient(app)
    res = client.get("/install.ps1")
    assert res.status_code == 200
    assert "Mini Pipeline runner installer (Windows)" in res.text
    assert "||" not in res.text
    assert "$Server = if ($env:MINI_PIPELINE_SERVER)" in res.text


def test_install_ps1_with_token():
    client = TestClient(app)
    res = client.get("/install.ps1?token=mrt_test_token_456")
    assert res.status_code == 200
    expected = (
        "$Token  = if ($env:MINI_PIPELINE_TOKEN) { "
        "$env:MINI_PIPELINE_TOKEN } else { 'mrt_test_token_456' }"
    )
    assert expected in res.text


def test_install_universal_endpoint():
    client = TestClient(app)
    # Test PowerShell detection
    res_ps = client.get(
        "/install?token=mrt_ps",
        headers={"User-Agent": "WindowsPowerShell/5.1.19041.1"},
    )
    assert res_ps.status_code == 200
    assert "Mini Pipeline runner installer (Windows)" in res_ps.text
    assert "mrt_ps" in res_ps.text

    # Test curl / Unix detection
    res_sh = client.get(
        "/install?token=mrt_sh",
        headers={"User-Agent": "curl/7.88.1"},
    )
    assert res_sh.status_code == 200
    assert "Mini Pipeline runner installer (Linux/macOS)" in res_sh.text
    assert "mrt_sh" in res_sh.text


def test_package_tarball_endpoint():
    client = TestClient(app)
    res = client.get("/install/package.tar.gz")
    assert res.status_code == 200
    assert "application/gzip" in res.headers.get("content-type", "")

    with tarfile.open(fileobj=io.BytesIO(res.content), mode="r:gz") as tar:
        names = tar.getnames()
        assert "pyproject.toml" in names
        assert any(name.startswith("mini_pipeline/") for name in names)
