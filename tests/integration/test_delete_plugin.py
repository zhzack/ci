import io


def test_delete_plugin_removes_record_and_files(client, plugin_zip, settings) -> None:
    archive = plugin_zip(name="del-demo")
    upload = client.post(
        "/api/plugins/upload",
        files={"file": ("del-demo.zip", io.BytesIO(archive), "application/zip")},
    )
    assert upload.status_code == 201

    listed = client.get("/api/plugins").json()["items"]
    assert any(item["name"] == "del-demo" for item in listed)

    install_path = settings.storage.plugins / "del-demo" / "1.0.0"
    assert install_path.is_dir()

    response = client.delete("/api/plugins/del-demo/1.0.0")
    assert response.status_code == 204

    listed = client.get("/api/plugins").json()["items"]
    assert not any(item["name"] == "del-demo" for item in listed)

    assert not install_path.exists()

    # Idempotent: deleting again returns 404
    response = client.delete("/api/plugins/del-demo/1.0.0")
    assert response.status_code == 404
