def test_dashboard_summary_returns_serializable_payload(client, plugin_zip) -> None:
    archive = plugin_zip(name="dash-demo")
    response = client.post(
        "/api/plugins/upload",
        files={"file": ("dash-demo.zip", archive, "application/zip")},
    )
    assert response.status_code == 201

    pipeline = client.post(
        "/api/pipelines",
        json={
            "definition": "name: dash-pipeline\nsteps:\n  - {name: a, plugin: dash-demo@1.0.0}\n"
        },
    )
    assert pipeline.status_code == 201

    summary = client.get("/api/dashboard/summary")
    assert summary.status_code == 200
    body = summary.json()
    assert body["counts"]["plugins"] >= 1
    assert body["counts"]["pipelines"] >= 1
    assert isinstance(body["recent_runs"], list)
    assert isinstance(body["pipelines"], list)
    assert all("id" in item and "name" in item for item in body["pipelines"])
    assert all(
        item["id"]
        and item["name"]
        and item["version"]
        and item["source_type"]
        for item in body["plugins"]
    )
    assert "version" in body["system"]
