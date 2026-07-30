def test_manifest_endpoint(client, plugin_zip) -> None:
    archive = plugin_zip(name="manifest-demo")
    response = client.post(
        "/api/plugins/upload",
        files={"file": ("manifest-demo.zip", archive, "application/zip")},
    )
    assert response.status_code == 201

    body = client.get("/api/plugins/manifest-demo/1.0.0/manifest").json()
    assert body["name"] == "manifest-demo"
    assert body["version"] == "1.0.0"
    assert body["runtime"]["type"] == "shell"
    assert body["entry"] == "run.sh"
    assert "inputs" in body and "outputs" in body
