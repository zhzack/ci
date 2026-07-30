import io
from pathlib import Path

from mini_pipeline.domain.runtime import RuntimeRequest
from mini_pipeline.runtime.shell import ShellRuntime


def test_shell_runtime_streams_output(tmp_path: Path) -> None:
    script = tmp_path / "run.sh"
    script.write_text("#!/bin/sh\necho hello\n", encoding="utf-8")
    script.chmod(0o755)
    log = io.StringIO()

    result = ShellRuntime().execute(
        RuntimeRequest(
            command=[str(script)],
            cwd=tmp_path,
            environment={},
            timeout_seconds=2,
            log_stream=log,
        )
    )

    assert result.exit_code == 0
    assert log.getvalue() == "hello\n"


def test_shell_runtime_enforces_timeout(tmp_path: Path) -> None:
    script = tmp_path / "slow.sh"
    script.write_text("#!/bin/sh\nsleep 5\n", encoding="utf-8")
    script.chmod(0o755)

    result = ShellRuntime().execute(
        RuntimeRequest(
            command=[str(script)],
            cwd=tmp_path,
            environment={},
            timeout_seconds=1,
            log_stream=io.StringIO(),
        )
    )

    assert result.timed_out is True
