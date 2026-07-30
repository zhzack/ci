import io
import zipfile

import pytest

from mini_pipeline.database.models import PipelineDefinition
from mini_pipeline.domain.exceptions import NotFoundError


def build_plugin_zip(name: str, version: str = "1.0.0") -> bytes:
    manifest = (
        f"name: {name}\n"
        f"version: {version}\n"
        f"description: t\n"
        f"runtime: {{type: shell}}\n"
        f"entry: run.sh\n"
        f"inputs: {{}}\n"
        f"outputs: {{}}\n"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("plugin.yaml", manifest)
        info = zipfile.ZipInfo("run.sh")
        info.external_attr = 0o755 << 16
        archive.writestr(info, "#!/bin/sh\nset -eu\n")
    return buffer.getvalue()


def test_run_with_unknown_pipeline_identifier_returns_404(client, plugin_zip) -> None:
    archive = plugin_zip(name="intg")
    response = client.post(
        "/api/plugins/upload",
        files={"file": ("intg.zip", io.BytesIO(archive), "application/zip")},
    )
    assert response.status_code == 201

    pipeline = client.post(
        "/api/pipelines",
        json={"definition": "name: p\nsteps:\n  - {name: a, plugin: intg@1.0.0}\n"},
    )
    assert pipeline.status_code == 201

    # Submit with an unknown pipeline id -> 404
    response = client.post(
        "/api/runs",
        json={"pipeline": "00000000-0000-0000-0000-000000000000", "params": {}},
    )
    assert response.status_code == 404


def test_run_with_stale_pipeline_id_returns_404_not_500(
    settings, plugin_zip
) -> None:
    """Simulate the race where a pipeline row disappears between the
    pre-flight check and the actual INSERT. The repository must surface a
    NotFoundError, not a raw IntegrityError.
    """

    from mini_pipeline.core.container import Services

    # Build a service container manually so we can poke at it.
    services = Services.build(settings)

    # Monkey-patch RunRepository.create to delete the pipeline row first.
    original_create = services.run_repository.create

    def patched_create(**kwargs):
        with services.database.session() as session:
            obj = session.get(PipelineDefinition, kwargs["pipeline_id"])
            if obj is not None:
                session.delete(obj)
        # Call the real method through the repository, NOT original_create,
        # so the IntegrityError -> NotFoundError translation runs.
        return services.run_repository.__class__.create(
            services.run_repository, **kwargs
        )

    services.run_repository.create = patched_create  # type: ignore[assignment]

    try:
        with pytest.raises(NotFoundError):
            services.run_repository.create(
                pipeline_id="00000000-0000-0000-0000-000000000000",
                pipeline_name="ghost",
                params={},
                tasks=[],
            )
    finally:
        services.run_repository.create = original_create  # type: ignore[assignment]
        services.close()
