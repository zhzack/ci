def test_update_pipeline_definition(client, plugin_zip) -> None:
    archive = plugin_zip(name="upd-demo")
    response = client.post(
        "/api/plugins/upload",
        files={"file": ("upd-demo.zip", archive, "application/zip")},
    )
    assert response.status_code == 201

    create = client.post(
        "/api/pipelines",
        json={"definition": "name: upd\nsteps:\n  - {name: a, plugin: upd-demo@1.0.0}\n"},
    )
    assert create.status_code == 201
    pipeline_id = create.json()["id"]

    new_definition = (
        "name: upd\nparams:\n  greeting: hi\nsteps:\n"
        "  - {name: a, plugin: upd-demo@1.0.0, with: {greeting: '${{ params.greeting }}'}}\n"
    )
    update = client.put(
        f"/api/pipelines/{pipeline_id}",
        json={"definition": new_definition},
    )
    assert update.status_code == 200, update.text
    body = client.get(f"/api/pipelines/{pipeline_id}")
    assert body.status_code == 200
    assert "greeting" in body.text

    not_found = client.put(
        "/api/pipelines/does-not-exist",
        json={"definition": new_definition},
    )
    assert not_found.status_code == 404


def test_params_schema_lists_inputs(client, plugin_zip) -> None:
    archive = plugin_zip(name="schema-demo")
    response = client.post(
        "/api/plugins/upload",
        files={"file": ("schema-demo.zip", archive, "application/zip")},
    )
    assert response.status_code == 201

    create = client.post(
        "/api/pipelines",
        json={
            "definition": (
                "name: schema-pipe\n"
                "params: {who: world}\n"
                "steps:\n"
                "  - {name: a, plugin: schema-demo@1.0.0}\n"
            )
        },
    )
    assert create.status_code == 201
    pipeline_id = create.json()["id"]

    schema = client.get(f"/api/pipelines/{pipeline_id}/params-schema")
    assert schema.status_code == 200
    body = schema.json()
    assert body["name"] == "schema-pipe"
    assert body["global_params"] == {"who": "world"}
    assert len(body["steps"]) == 1
    assert body["steps"][0]["name"] == "a"
    assert body["steps"][0]["plugin"] == "schema-demo@1.0.0"
    assert body["steps"][0]["fields"] == []


def test_params_schema_handles_missing_plugin(client) -> None:
    create = client.post(
        "/api/pipelines",
        json={
            "definition": (
                "name: broken-pipe\n"
                "steps:\n"
                "  - {name: a, plugin: never-installed@9.9.9}\n"
            )
        },
    )
    assert create.status_code == 201
    pipeline_id = create.json()["id"]

    schema = client.get(f"/api/pipelines/{pipeline_id}/params-schema")
    assert schema.status_code == 200
    body = schema.json()
    assert body["steps"][0]["fields"] == []
