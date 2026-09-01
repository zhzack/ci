"""Git plugin source provider."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from collections.abc import Mapping
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlsplit, urlunsplit

from mini_pipeline.domain.exceptions import SourceError
from mini_pipeline.source.archive import normalize_plugin_root


def _build_authenticated_url(url: str, cred: dict[str, Any] | None) -> str:
    if not cred:
        return url

    username = str(cred.get("username") or "").strip()
    password = str(cred.get("password") or "").strip()
    secret = str(cred.get("secret") or "").strip()

    if not url.startswith(("http://", "https://")):
        return url

    parts = urlsplit(url)
    if username and password:
        auth_netloc = f"{quote(username, safe='')}:{quote(password, safe='')}@{parts.hostname}"
        if parts.port:
            auth_netloc += f":{parts.port}"
        return urlunsplit((parts.scheme, auth_netloc, parts.path, parts.query, parts.fragment))
    elif secret:
        # Many git hosts (GitHub, GitLab, Gitee) support oauth2:<token> or <token>:<token>
        auth_netloc = f"oauth2:{quote(secret, safe='')}@{parts.hostname}"
        if parts.port:
            auth_netloc += f":{parts.port}"
        return urlunsplit((parts.scheme, auth_netloc, parts.path, parts.query, parts.fragment))

    return url


def _setup_ssh_env(cred: dict[str, Any] | None) -> tuple[dict[str, str], str | None]:
    """Creates a temporary SSH key file and returns (env_dict, temp_key_file_path)."""
    env = os.environ.copy()
    if not cred or not cred.get("private_key"):
        return env, None

    key_content = str(cred["private_key"]).strip()
    if not key_content.endswith("\n"):
        key_content += "\n"

    # Create temporary key file
    fd, key_path = tempfile.mkstemp(prefix="git_ssh_key_", suffix=".pem")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(key_content)
        # On POSIX, chmod 600 is required by SSH
        try:
            os.chmod(key_path, 0o600)
        except Exception:
            pass
    except Exception:
        os.unlink(key_path)
        raise

    env["GIT_SSH_COMMAND"] = (
        f'ssh -i "{key_path}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null'
    )
    return env, key_path


class GitSource:
    source_type = "git"

    @classmethod
    def list_remote_branches(
        cls, url: str, credential_payload: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """Probe remote Git repository using ls-remote and return branches,
        tags, and default branch.
        """
        clean_url = str(url).strip()
        if not clean_url:
            raise SourceError("Git url is required")

        git = shutil.which("git")
        if git is None:
            raise SourceError("git executable is not installed")

        auth_url = _build_authenticated_url(clean_url, credential_payload)
        env, ssh_key_path = _setup_ssh_env(credential_payload)

        try:
            cmd = [git, "ls-remote", "--heads", "--tags", auth_url]
            res = subprocess.run(
                cmd,
                check=True,
                capture_output=True,
                text=True,
                timeout=30,
                env=env,
            )
        except subprocess.TimeoutExpired as exc:
            raise SourceError("Remote Git repository probe timed out (30s)") from exc
        except subprocess.CalledProcessError as exc:
            detail = exc.stderr.strip() or "Failed to connect to remote Git repository"
            # Avoid leaking password in error message if present in auth_url
            if "@" in detail:
                detail = detail.split("@")[-1]
            raise SourceError(f"Git remote error: {detail}") from exc
        finally:
            if ssh_key_path and os.path.exists(ssh_key_path):
                try:
                    os.unlink(ssh_key_path)
                except Exception:
                    pass

        branches: list[str] = []
        tags: list[str] = []
        for line in res.stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            parts = line.split()
            if len(parts) < 2:
                continue
            ref = parts[1]
            if ref.startswith("refs/heads/"):
                b_name = ref.removeprefix("refs/heads/")
                if b_name and b_name not in branches:
                    branches.append(b_name)
            elif ref.startswith("refs/tags/"):
                t_name = ref.removeprefix("refs/tags/").removesuffix("^{}")
                if t_name and t_name not in tags:
                    tags.append(t_name)

        default_branch = ""
        if "main" in branches:
            default_branch = "main"
        elif "master" in branches:
            default_branch = "master"
        elif branches:
            default_branch = branches[0]

        return {
            "branches": branches,
            "tags": tags,
            "default_branch": default_branch,
        }

    def fetch(self, config: Mapping[str, Any], destination: Path) -> Path:
        url = str(config.get("url", "")).strip()
        if not url:
            raise SourceError("Git source requires a url")
        revision = config.get("revision") or config.get("branch") or config.get("tag")
        git = shutil.which("git")
        if git is None:
            raise SourceError("git executable is not installed")

        cred_payload = config.get("credential_payload")
        auth_url = _build_authenticated_url(url, cred_payload)
        env, ssh_key_path = _setup_ssh_env(cred_payload)

        try:
            command = [git, "clone", "--quiet", "--no-tags"]
            if revision:
                command.extend(["--branch", str(revision), "--single-branch"])
            command.extend([auth_url, str(destination)])
            try:
                subprocess.run(
                    command,
                    check=True,
                    capture_output=True,
                    text=True,
                    timeout=300,
                    env=env,
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
                        env=env,
                    )
                except (subprocess.TimeoutExpired, subprocess.CalledProcessError) as exc:
                    detail = getattr(exc, "stderr", "") or "git checkout failed"
                    raise SourceError(str(detail).strip()) from exc
            shutil.rmtree(destination / ".git", ignore_errors=True)
            return normalize_plugin_root(destination)
        finally:
            if ssh_key_path and os.path.exists(ssh_key_path):
                try:
                    os.unlink(ssh_key_path)
                except Exception:
                    pass
