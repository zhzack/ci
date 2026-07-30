def test_delete_pipeline_returns_204(client, plugin_zip) -> None:
    archive = plugin_zip(name="delpipe")
    response = client.post(
        "/api/plugins/upload",
        files={"file": ("delpipe.zip", archive, "application/zip")},
    )
    assert response.status_code == 201

    created = client.post(
        "/api/pipelines",
        json={"definition": "name: dp\nsteps:\n  - {name: a, plugin: delpipe@1.0.0}\n"},
    )
    assert created.status_code == 201
    pipeline_id = created.json()["id"]

    deleted = client.delete(f"/api/pipelines/{pipeline_id}")
    assert deleted.status_code == 204

    # Re-fetch returns 404
    gone = client.get(f"/api/pipelines/{pipeline_id}")
    assert gone.status_code == 404

    # Delete again returns 404
    again = client.delete(f"/api/pipelines/{pipeline_id}")
    assert again.status_code == 404
