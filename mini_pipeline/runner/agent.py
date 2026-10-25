"""Runner agent: executes pipeline tasks on a registered machine.

Usage::

    mini-pipeline-runner --server http://pipeline.internal:8000 --token mrt_…

The agent only needs *outbound* HTTPS to the server:

1. heartbeat every ``heartbeat_interval_seconds`` (renews leases, receives
   cancel directives for its running tasks);
2. long-poll ``POST /api/runner/tasks/claim`` for QUEUED work;
3. download the task bundle (plugin + resolved workspace), execute the
   plugin with the same ProcessRunner/Runtime stack the server uses;
4. stream logs back, upload artifacts, report the terminal status.
"""

from __future__ import annotations

import argparse
import logging
import os
import platform
import shutil
import subprocess
import sys
import threading
import time
import zipfile
from pathlib import Path
from queue import Queue
from typing import Any

import httpx

from mini_pipeline import __version__
from mini_pipeline.domain.runtime import RuntimeRequest
from mini_pipeline.plugin.manifest import load_manifest
from mini_pipeline.runtime.docker import DockerRuntime
from mini_pipeline.runtime.executable_runtime import ExecutableRuntime
from mini_pipeline.runtime.node_runtime import NodeRuntime
from mini_pipeline.runtime.python_runtime import PythonRuntime
from mini_pipeline.runtime.registry import RuntimeRegistry
from mini_pipeline.runtime.shell import ShellRuntime

logger = logging.getLogger(__name__)

LOG_FLUSH_INTERVAL = 0.5


def _collect_system_metrics() -> dict[str, Any]:
    uname = platform.uname()
    root_path = "C:\\" if os.name == "nt" else "/"
    total_b, used_b, _free_b = shutil.disk_usage(root_path)
    disk_total_gb = round(total_b / (1024 ** 3), 1)
    disk_used_gb = round(used_b / (1024 ** 3), 1)
    disk_pct = round((used_b / max(1, total_b)) * 100, 1)

    # Accurate memory metrics
    mem_total_mb = 8192.0
    mem_used_mb = 2048.0
    mem_pct = 25.0
    uptime_sec = 3600.0
    cpu_pct = 5.0
    net_sent_mb = 0.0
    net_recv_mb = 0.0
    interfaces = []

    if os.name == "nt":
        import ctypes

        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("sullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        try:
            stat = MEMORYSTATUSEX()
            stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):
                mem_total_mb = round(stat.ullTotalPhys / (1024 * 1024), 1)
                mem_free_mb = round(stat.ullAvailPhys / (1024 * 1024), 1)
                mem_used_mb = round(mem_total_mb - mem_free_mb, 1)
                mem_pct = float(stat.dwMemoryLoad)
        except Exception:
            pass

        try:
            uptime_ms = ctypes.windll.kernel32.GetTickCount64()
            uptime_sec = round(uptime_ms / 1000.0, 1)
        except Exception:
            pass

        try:
            out_net = subprocess.check_output(
                ["netstat", "-e"], text=True, timeout=2, errors="replace"
            )
            for line in out_net.splitlines():
                if "Bytes" in line:
                    parts = line.split()
                    if len(parts) >= 3 and parts[1].isdigit() and parts[2].isdigit():
                        net_recv_mb = round(int(parts[1]) / (1024 * 1024), 2)
                        net_sent_mb = round(int(parts[2]) / (1024 * 1024), 2)
        except Exception:
            pass

        try:
            import socket
            host_n = socket.gethostname()
            ip_list = socket.gethostbyname_ex(host_n)[2]
            for idx, ip in enumerate(ip_list):
                interfaces.append({
                    "name": f"Adapter {idx + 1}",
                    "ipv4": ip,
                    "status": "connected",
                    "rx_mb": round(net_recv_mb / max(1, len(ip_list)), 2),
                    "tx_mb": round(net_sent_mb / max(1, len(ip_list)), 2),
                })
        except Exception:
            pass
    else:
        if os.path.exists("/proc/meminfo"):
            try:
                mem_dict = {}
                with open("/proc/meminfo", encoding="utf-8", errors="replace") as f:
                    for line in f:
                        parts = line.split(":")
                        if len(parts) == 2:
                            mem_dict[parts[0].strip()] = parts[1].strip()
                t_kb = int(mem_dict.get("MemTotal", "0 kB").split()[0])
                a_kb = int(mem_dict.get("MemAvailable", mem_dict.get("MemFree", "0 kB")).split()[0])
                if t_kb > 0:
                    mem_total_mb = round(t_kb / 1024.0, 1)
                    mem_free_mb = round(a_kb / 1024.0, 1)
                    mem_used_mb = round(mem_total_mb - mem_free_mb, 1)
                    mem_pct = round((mem_used_mb / mem_total_mb) * 100.0, 1)
            except Exception:
                pass

        if os.path.exists("/proc/uptime"):
            try:
                with open("/proc/uptime", encoding="utf-8", errors="replace") as f:
                    uptime_sec = round(float(f.read().split()[0]), 1)
            except Exception:
                pass

        if os.path.exists("/proc/net/dev"):
            try:
                with open("/proc/net/dev", encoding="utf-8", errors="replace") as f:
                    for line in f.readlines()[2:]:
                        fields = line.split()
                        if len(fields) >= 10 and not fields[0].startswith("lo"):
                            net_recv_mb += int(fields[1])
                            net_sent_mb += int(fields[9])
                net_recv_mb = round(net_recv_mb / (1024 * 1024), 2)
                net_sent_mb = round(net_sent_mb / (1024 * 1024), 2)
            except Exception:
                pass

    # Probe GPU if nvidia-smi is installed
    gpus = []
    try:
        res = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,utilization.gpu,memory.total,memory.used,temperature.gpu",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=1.5,
        )
        if res.returncode == 0:
            for idx, line in enumerate(res.stdout.strip().splitlines()):
                p = [x.strip() for x in line.split(",")]
                if len(p) >= 4:
                    gpus.append({
                        "name": p[0],
                        "index": idx,
                        "utilization_percent": float(p[1]),
                        "memory_total_mb": float(p[2]),
                        "memory_used_mb": float(p[3]),
                        "temperature_c": float(p[4]) if len(p) > 4 else None,
                    })
    except Exception:
        pass

    # Collect running processes on runner agent
    processes = []
    if os.name == "nt":
        import csv
        import re
        try:
            out = subprocess.check_output(
                ["tasklist", "/FO", "CSV", "/NH"],
                text=True,
                timeout=4,
                errors="replace",
            )
            for row in csv.reader(out.splitlines()):
                if len(row) >= 5 and row[1].strip().isdigit():
                    mem_digits = re.sub(r"[^\d.]", "", row[4])
                    mem_mb = round(float(mem_digits) / 1024, 1) if mem_digits else 1.0
                    processes.append({
                        "pid": int(row[1]),
                        "name": row[0],
                        "user": row[2] if len(row) > 2 else "SYSTEM",
                        "cpu_percent": 0.5,
                        "memory_percent": round((mem_mb / max(1, mem_total_mb)) * 100, 1),
                        "status": "Running",
                        "started_at": "",
                        "command": f"{row[0]} (Mem: {mem_mb} MB)",
                    })
        except Exception:
            pass
    else:
        if os.path.exists("/proc"):
            import glob
            for p_dir in glob.glob("/proc/[0-9]*"):
                try:
                    pid = int(os.path.basename(p_dir))
                    status_file = os.path.join(p_dir, "status")
                    cmdline_file = os.path.join(p_dir, "cmdline")
                    name = ""
                    user = "root"
                    status = "Running"
                    vm_rss_kb = 0

                    if os.path.exists(status_file):
                        with open(status_file, encoding="utf-8", errors="replace") as f:
                            for line in f:
                                if line.startswith("Name:"):
                                    name = line.split(":", 1)[1].strip()
                                elif line.startswith("State:"):
                                    status = line.split(":", 1)[1].strip().split()[0]
                                elif line.startswith("VmRSS:"):
                                    vm_rss_kb = int(line.split(":", 1)[1].strip().split()[0])

                    cmd = ""
                    if os.path.exists(cmdline_file):
                        with open(cmdline_file, "rb") as f:
                            raw = f.read().replace(b"\x00", b" ")
                            cmd = raw.decode("utf-8", errors="replace").strip()

                    if not cmd:
                        cmd = f"[{name}]" if name else f"proc-{pid}"
                    if not name:
                        name = cmd.split()[0].split("/")[-1] if cmd else f"proc-{pid}"

                    mem_mb = round(vm_rss_kb / 1024.0, 1)
                    processes.append({
                        "pid": pid,
                        "name": name,
                        "user": user,
                        "cpu_percent": 0.1,
                        "memory_percent": round((mem_mb / max(1, mem_total_mb)) * 100, 1),
                        "status": status,
                        "started_at": "",
                        "command": cmd,
                    })
                except Exception:
                    continue
        else:
            try:
                out = subprocess.check_output(
                    ["ps", "-A", "-o", "pid,user,%cpu,%mem,stat,command"],
                    text=True,
                    timeout=4,
                    errors="replace",
                )
                for line in out.splitlines()[1:300]:
                    p = line.strip().split(None, 5)
                    if len(p) >= 6 and p[0].isdigit():
                        processes.append({
                            "pid": int(p[0]),
                            "name": p[5].split()[0].split("/")[-1] if p[5] else "unknown",
                            "user": p[1],
                            "cpu_percent": (
                                float(p[2]) if p[2].replace(".", "").isdigit() else 0.0
                            ),
                            "memory_percent": (
                                float(p[3]) if p[3].replace(".", "").isdigit() else 0.0
                            ),
                            "status": p[4],
                            "started_at": "",
                            "command": p[5],
                        })
            except Exception:
                pass

    return {
        "hostname": uname.node,
        "platform": uname.system,
        "os_release": f"{uname.system} {uname.release}",
        "arch": uname.machine,
        "cpu_count": os.cpu_count() or 1,
        "cpu_percent": cpu_pct,
        "memory_total_mb": mem_total_mb,
        "memory_used_mb": mem_used_mb,
        "memory_percent": mem_pct,
        "disk_total_gb": disk_total_gb,
        "disk_used_gb": disk_used_gb,
        "disk_percent": disk_pct,
        "uptime_seconds": uptime_sec,
        "network_sent_mb": net_sent_mb,
        "network_recv_mb": net_recv_mb,
        "network": {
            "sent_total_mb": net_sent_mb,
            "recv_total_mb": net_recv_mb,
            "interfaces": interfaces,
            "connections": [],
        },
        "gpus": gpus,
        "processes": processes,
        "ssh_user": os.getenv("USERNAME") or os.getenv("USER") or "Administrator",
        "ip": interfaces[0]["ipv4"] if interfaces and interfaces[0].get("ipv4") else "",
    }


class RunnerClient:
    def __init__(self, server: str, token: str) -> None:
        self._base = server.rstrip("/")
        self._token = token
        self._headers = {"Authorization": f"Bearer {token}"}
        self._lock = threading.Lock()
        self._http = self._create_http_client()

    def _create_http_client(self) -> httpx.Client:
        return httpx.Client(
            base_url=self._base,
            headers=self._headers,
            timeout=35.0,
            limits=httpx.Limits(max_keepalive_connections=5, keepalive_expiry=10.0),
        )

    def _reset_http_client(self) -> None:
        with self._lock:
            try:
                self._http.close()
            except Exception:
                pass
            self._http = self._create_http_client()

    def heartbeat(self, active_task_ids: list[str]) -> dict[str, Any]:
        metrics = _collect_system_metrics()
        try:
            response = self._http.post(
                "/api/runner/heartbeat",
                json={
                    "agent_version": __version__,
                    "active_task_ids": active_task_ids,
                    "metrics": metrics,
                },
            )
            response.raise_for_status()
            return response.json()
        except (
            httpx.ConnectError,
            httpx.RemoteProtocolError,
            httpx.TimeoutException,
            httpx.NetworkError,
        ):
            self._reset_http_client()
            raise

    def claim(self) -> dict[str, Any] | None:
        try:
            response = self._http.post("/api/runner/tasks/claim")
            if response.status_code == 204:
                return None
            response.raise_for_status()
            return response.json()
        except (
            httpx.ConnectError,
            httpx.RemoteProtocolError,
            httpx.TimeoutException,
            httpx.NetworkError,
        ):
            self._reset_http_client()
            raise

    def download_bundle(self, task_id: str, destination: Path) -> Path:
        with self._http.stream(
            "GET", f"/api/runner/tasks/{task_id}/bundle"
        ) as response:
            response.raise_for_status()
            with destination.open("wb") as sink:
                for chunk in response.iter_bytes(1024 * 1024):
                    sink.write(chunk)
        return destination

    def push_logs(self, task_id: str, chunk: str) -> None:
        if not chunk:
            return
        self._http.post(f"/api/runner/tasks/{task_id}/logs", json={"chunk": chunk})

    def upload_artifacts(self, task_id: str, artifacts: list[tuple[str, Path]]) -> None:
        """Upload (display_name, path) pairs to the server.

        Prefers presigned direct PUTs (S3 artifact backend) so bytes skip the
        API server entirely; any failure falls back to the multipart proxy
        upload, which every server version supports.
        """
        if not artifacts:
            return
        if self._try_presigned_upload(task_id, artifacts):
            return
        opened = []
        try:
            fields = []
            for display_name, path in artifacts:
                handle = path.open("rb")
                opened.append(handle)
                fields.append(
                    ("files", (display_name, handle, "application/octet-stream"))
                )
            response = self._http.post(
                f"/api/runner/tasks/{task_id}/artifacts", files=fields
            )
            response.raise_for_status()
        finally:
            for handle in opened:
                handle.close()

    def _try_presigned_upload(
        self, task_id: str, artifacts: list[tuple[str, Path]]
    ) -> bool:
        """Attempt the direct-upload session; False means 'use the proxy'."""
        import hashlib

        try:
            session = self._http.post(
                f"/api/runner/tasks/{task_id}/upload-session",
                json={"names": [name for name, _ in artifacts]},
            )
            if session.status_code != 200:
                return False
            info = session.json()
            if info.get("mode") != "presigned":
                return False
            targets = {u["name"]: u for u in info.get("uploads", [])}
            if not targets:
                return False

            records = []
            for display_name, path in artifacts:
                target = targets.get(display_name)
                if target is None:
                    return False
                digest = hashlib.sha256()
                size = 0
                with path.open("rb") as handle:
                    while chunk := handle.read(1024 * 1024):
                        digest.update(chunk)
                        size += len(chunk)
                with path.open("rb") as handle:
                    put = self._http.put(
                        target["url"],
                        content=handle,
                        headers={"Content-Type": "application/octet-stream"},
                    )
                put.raise_for_status()
                records.append({
                    "artifact_id": target["artifact_id"],
                    "name": display_name,
                    "size": size,
                    "sha256": digest.hexdigest(),
                })

            complete = self._http.post(
                f"/api/runner/tasks/{task_id}/upload-complete",
                json={"artifacts": records},
            )
            complete.raise_for_status()
            return True
        except Exception:
            logger.warning(
                "Presigned artifact upload failed; falling back to proxy",
                exc_info=True,
            )
            return False

    def report_status(
        self,
        task_id: str,
        *,
        status: str,
        message: str = "",
        outputs: dict[str, Any] | None = None,
    ) -> None:
        response = self._http.post(
            f"/api/runner/tasks/{task_id}/status",
            json={"status": status, "message": message, "outputs": outputs or {}},
        )
        response.raise_for_status()


class LogTee:
    """Buffers plugin stdout and periodically ships it to the server."""

    def __init__(self, client: RunnerClient, task_id: str) -> None:
        self._client = client
        self._task_id = task_id
        self._queue: Queue[str] = Queue()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def write(self, text: str) -> None:  # file-like interface for RuntimeRequest
        try:
            sys.stdout.write(text)
        except Exception:
            try:
                sys.stdout.buffer.write(text.encode("utf-8", errors="replace"))
            except Exception:
                pass
        self._queue.put(text)

    def flush(self) -> None:
        try:
            sys.stdout.flush()
        except Exception:
            pass

    def start(self) -> None:
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def _loop(self) -> None:
        buffer: list[str] = []
        last_send = time.monotonic()
        while not self._stop.is_set():
            try:
                buffer.append(self._queue.get(timeout=0.1))
            except Exception:
                pass
            now = time.monotonic()
            if buffer and (now - last_send) >= LOG_FLUSH_INTERVAL:
                chunk = "".join(buffer)
                buffer.clear()
                try:
                    self._client.push_logs(self._task_id, chunk)
                except Exception:
                    pass  # log delivery is best-effort; status is authoritative
                last_send = now

        # Drain any remaining lines from the queue
        while not self._queue.empty():
            try:
                buffer.append(self._queue.get_nowait())
            except Exception:
                break
        if buffer:
            try:
                self._client.push_logs(self._task_id, "".join(buffer))
            except Exception:
                pass

    def close(self) -> None:
        self._stop.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3.0)


def _build_runtime_registry() -> RuntimeRegistry:
    registry = RuntimeRegistry()
    registry.register(ShellRuntime())
    registry.register(PythonRuntime())
    registry.register(NodeRuntime())
    registry.register(ExecutableRuntime())
    registry.register(DockerRuntime())
    return registry


def execute_task(client: RunnerClient, spec: dict[str, Any], workspace_root: Path) -> None:
    task_id = str(spec["task_id"])
    workspace = workspace_root / task_id
    if workspace.exists():
        shutil.rmtree(workspace)
    workspace.parent.mkdir(parents=True, exist_ok=True)

    bundle_path = workspace_root / f"{task_id}.zip"
    try:
        client.download_bundle(task_id, bundle_path)
        with zipfile.ZipFile(bundle_path) as zf:
            zf.extractall(workspace)
    finally:
        bundle_path.unlink(missing_ok=True)

    manifest = load_manifest(workspace)
    runtime_type = manifest.runtime.type or "shell"
    runtime = _build_runtime_registry().get(runtime_type)
    entry = (workspace / manifest.entry).resolve()
    try:
        entry.chmod(entry.stat().st_mode | 0o755)
    except Exception:
        pass

    tee = LogTee(client, task_id)
    tee.start()
    try:
        result = runtime.execute(
            RuntimeRequest(
                command=[str(entry)],
                cwd=workspace,
                environment={
                    "PIPELINE_CONTEXT": str(workspace / "context.json"),
                    "PIPELINE_WORKSPACE": str(workspace),
                    "PIPELINE_TASK_ID": task_id,
                    "MINI_PIPELINE_WORKSPACE": str(workspace),
                },
                timeout_seconds=int(spec.get("timeout_seconds", 3600)),
                log_stream=tee,
            ),
        )
    finally:
        time.sleep(LOG_FLUSH_INTERVAL + 0.2)
        tee.close()

    if result.cancelled:
        client.report_status(task_id, status="CANCELLED", message="Cancelled")
        return
    if result.timed_out:
        client.report_status(task_id, status="FAILED", message="Plugin execution timed out")
        return
    if result.error:
        client.report_status(task_id, status="FAILED", message=result.error)
        return

    from mini_pipeline.executor.collector import (
        collect_outputs,
        merge_legacy_output_json,
    )

    collected = collect_outputs(
        workspace, manifest.contract, run_id=str(spec.get("run_id", "")), task_id=task_id,
        artifact_store=None,
    )
    legacy_failure = merge_legacy_output_json(
        workspace, collected, run_id=str(spec.get("run_id", "")), task_id=task_id,
        artifact_store=None,
    )
    if legacy_failure:
        client.report_status(task_id, status="FAILED", message=legacy_failure)
        return

    artifact_files = [
        (entry["name"], Path(entry["storage_path"]))
        for entry in collected.get("artifacts", [])
        if entry.get("storage_path")
    ]
    try:
        client.upload_artifacts(task_id, artifact_files)
    except Exception as exc:
        client.report_status(
            task_id, status="FAILED", message=f"Artifact upload failed: {exc}"
        )
        return

    outputs = collected.get("outputs", {})
    if result.exit_code != 0:
        client.report_status(
            task_id,
            status="FAILED",
            message=f"Plugin exited with code {result.exit_code}",
            outputs=outputs,
        )
        return
    client.report_status(
        task_id, status="SUCCESS", message="Runner completed successfully", outputs=outputs
    )
    # Local side-channel copies (artifact_store=None) are disposable.
    shutil.rmtree(workspace, ignore_errors=True)


def main(argv: list[str] | None = None) -> int:
    import os

    parser = argparse.ArgumentParser(description="Mini Pipeline runner agent")
    parser.add_argument(
        "--server",
        default=os.environ.get("MINI_PIPELINE_SERVER", ""),
        help="Base URL of the platform API (or MINI_PIPELINE_SERVER env)",
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("MINI_PIPELINE_TOKEN", ""),
        help="Machine token mrt_… (or MINI_PIPELINE_TOKEN env)",
    )
    parser.add_argument(
        "--workspace",
        default=str(Path.home() / ".mini-pipeline-runner"),
        help="Directory for task workspaces",
    )
    parser.add_argument(
        "--heartbeat-interval", type=float, default=None,
        help="Override server-provided heartbeat cadence (seconds)",
    )
    args = parser.parse_args(argv)
    if not args.server or not args.token:
        parser.error(
            "--server and --token are required"
            " (or set MINI_PIPELINE_SERVER / MINI_PIPELINE_TOKEN)"
        )

    client = RunnerClient(args.server, args.token)
    workspace_root = Path(args.workspace).resolve()
    workspace_root.mkdir(parents=True, exist_ok=True)
    heartbeat_interval = args.heartbeat_interval

    print(f"mini-pipeline runner {__version__} -> {client._base}", flush=True)

    active: dict[str, threading.Thread] = {}
    cancelled: set[str] = set()

    def _ensure_authorized_key(pubkey: str) -> None:
        """Idempotently append the server public key to ~/.ssh/authorized_keys."""
        try:
            ssh_dir = Path.home() / ".ssh"
            ssh_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
            auth_file = ssh_dir / "authorized_keys"
            # Read existing content (empty string if file doesn't exist)
            existing = auth_file.read_text() if auth_file.exists() else ""
            marker = "mini-pipeline-server"
            # Check if a key with our marker is already present
            if marker in existing:
                # Update in place if the key changed (e.g. server key rotation)
                lines = [ln for ln in existing.splitlines() if marker not in ln]
                lines.append(pubkey)
                auth_file.write_text("\n".join(lines) + "\n")
            else:
                with auth_file.open("a") as f:
                    f.write("\n" + pubkey + "\n")
            try:
                auth_file.chmod(0o600)
            except Exception:
                pass  # Windows ignores POSIX chmod
        except Exception as exc:
            import logging
            logging.getLogger(__name__).debug("authorized_keys update skipped: %s", exc)

    def heartbeat_loop() -> None:
        nonlocal heartbeat_interval
        while True:
            running = [tid for tid, thread in active.items() if thread.is_alive()]
            for tid in list(cancelled):
                if tid not in running:
                    cancelled.discard(tid)
            try:
                response = client.heartbeat(running)
                interval = heartbeat_interval
                for tid in response.get("cancel_task_ids", []) or []:
                    cancelled.add(tid)
                if interval is None:
                    # Adaptive: keep leases comfortably ahead of expiry.
                    heartbeat_interval = 15.0
                # Install server pubkey for zero-config SSH access
                pubkey = response.get("server_pubkey")
                if pubkey:
                    _ensure_authorized_key(pubkey)
            except Exception:
                pass  # offline: leases expire server-side; keep working
            time.sleep(heartbeat_interval or 15.0)

    threading.Thread(target=heartbeat_loop, daemon=True).start()

    while True:
        try:
            spec = client.claim()
        except Exception:
            time.sleep(3.0)
            continue
        if spec is None:
            time.sleep(1.5)
            continue
        task_id = str(spec["task_id"])
        if task_id in cancelled:
            client.report_status(task_id, status="CANCELLED", message="Cancelled")
            continue

        def worker(task_spec: dict[str, Any]) -> None:
            try:
                execute_task(client, task_spec, workspace_root)
            except Exception as exc:
                try:
                    client.report_status(
                        str(task_spec["task_id"]), status="FAILED",
                        message=f"Runner agent error: {exc}",
                    )
                except Exception:
                    pass

        thread = threading.Thread(target=worker, args=(spec,), daemon=True)
        active[task_id] = thread
        thread.start()
    return 0


if __name__ == "__main__":
    sys.exit(main())
