"""Git plugin source provider."""

import shutil
import subprocess
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from mini_pipeline.domain.exceptions import SourceError
from mini_pipeline.source.archive import normalize_plugin_root


class GitSource:
    source_type = "git"

    def fetch(self, config: Mapping[str, Any], destination: Path) -> Path:
        url = str(config.get("url", "")).strip()
        if not url:
            raise SourceError("Git source requires a url")
        revision = config.get("revision") or config.get("branch") or config.get("tag")
        git = shutil.which("git")
        if git is None:
            raise SourceError("git executable is not installed")

        command = [git, "clone", "--quiet", "--no-tags"]
        if revision:
            command.extend(["--branch", str(revision), "--single-branch"])
        command.extend([url, str(destination)])
        try:
            subprocess.run(
                command,
                check=True,
                capture_output=True,
                text=True,
                timeout=300,
            )
        except subprocess.TimeoutExpired as exc:
            raise SourceError("Git clone timed out") from exc
        except subprocess.CalledProcessError as exc:
            detail = exc.stderr.strip() or "git clone failed"
            raise SourceError(detail) from exc

        if config.get("commit"):
            try:
                subprocess.run(
                    [git, "-C", str(destination), "checkout", "--quiet", str(config["commit"])],
                    check=True,
                    capture_output=True,
                    text=True,
                    timeout=60,
                )
            except (subprocess.TimeoutExpired, subprocess.CalledProcessError) as exc:
                detail = getattr(exc, "stderr", "") or "git checkout failed"
                raise SourceError(str(detail).strip()) from exc
        shutil.rmtree(destination / ".git", ignore_errors=True)
        return normalize_plugin_root(destination)
