"""WebSocket router for real-time full-duplex PTY terminal sessions."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import select
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from mini_pipeline.api.auth import resolve_principal
from mini_pipeline.core.config import Settings
from mini_pipeline.database.models import Machine

logger = logging.getLogger("mini_pipeline.api.machine_terminal_ws")

router = APIRouter(prefix="/machines", tags=["machine-terminal-ws"])


async def _handle_ssh_terminal(
    websocket: WebSocket,
    services: Any,
    machine: Machine,
    cols: int,
    rows: int,
) -> None:
    """Bridge an interactive SSH PTY channel to WebSocket full-duplex."""
    client = None
    channel = None
    try:
        try:
            client, _ = services.diagnostics._connect_ssh(machine)
        except Exception as exc:
            logger.error("Failed to connect SSH for machine %s: %s", machine.id, exc)
            ip_val = machine.ip or "127.0.0.1"
            port_val = machine.port or 22
            await websocket.send_text(
                f"\r\n\x1b[31m[SSH 连接失败] {exc}\x1b[0m\r\n"
                f"\x1b[33m请检查节点的 SSH 凭据与地址（{ip_val}:{port_val}）。\x1b[0m\r\n"
            )
            await asyncio.sleep(3)
            return

        try:
            channel = client.invoke_shell(term="xterm-256color", width=cols, height=rows)
        except Exception as exc:
            logger.error("Failed to invoke shell on machine %s: %s", machine.id, exc)
            await websocket.send_text(f"\r\n\x1b[31m[Shell 启动失败] {exc}\x1b[0m\r\n")
            await asyncio.sleep(3)
            return

        loop = asyncio.get_running_loop()
        stop_event = asyncio.Event()

        async def read_from_channel() -> None:
            while not stop_event.is_set():
                try:
                    transport = client.get_transport() if client else None
                    if channel.closed or transport is None or not transport.is_active():
                        break
                    ready = await loop.run_in_executor(None, channel.recv_ready)
                    if ready:
                        data = await loop.run_in_executor(None, channel.recv, 4096)
                        if data:
                            await websocket.send_bytes(data)
                    err_ready = await loop.run_in_executor(None, channel.recv_stderr_ready)
                    if err_ready:
                        err_data = await loop.run_in_executor(None, channel.recv_stderr, 4096)
                        if err_data:
                            await websocket.send_bytes(err_data)
                    if not ready and not err_ready:
                        await asyncio.sleep(0.02)
                except Exception as exc:
                    logger.debug("SSH PTY read pump exception: %s", exc)
                    break
            stop_event.set()

        async def write_to_channel() -> None:
            while not stop_event.is_set():
                try:
                    message = await websocket.receive()
                    msg_type = message.get("type")
                    if msg_type == "websocket.disconnect":
                        break

                    raw_bytes = message.get("bytes")
                    text = message.get("text")

                    if text:
                        if text.startswith("{") and text.endswith("}"):
                            try:
                                payload = json.loads(text)
                                if payload.get("type") == "resize":
                                    new_cols = int(payload.get("cols", cols))
                                    new_rows = int(payload.get("rows", rows))
                                    channel.resize_pty(width=new_cols, height=new_rows)
                                    continue
                                if payload.get("type") == "ping":
                                    await websocket.send_text('{"type":"pong"}')
                                    continue
                            except Exception:
                                pass
                        encoded = text.encode("utf-8", errors="replace")
                        await loop.run_in_executor(None, channel.send, encoded)
                    elif raw_bytes:
                        await loop.run_in_executor(None, channel.send, raw_bytes)
                except Exception:
                    break
            stop_event.set()

        reader_task = asyncio.create_task(read_from_channel())
        writer_task = asyncio.create_task(write_to_channel())

        await asyncio.wait(
            [reader_task, writer_task],
            return_when=asyncio.FIRST_COMPLETED,
        )
        stop_event.set()
        reader_task.cancel()
        writer_task.cancel()

    finally:
        if channel is not None:
            try:
                channel.close()
            except Exception:
                pass
        if client is not None:
            try:
                client.close()
            except Exception:
                pass


async def _handle_windows_process_terminal(
    websocket: WebSocket,
    cols: int = 80,
    rows: int = 24,
) -> None:
    """Bridge a local Windows PowerShell interactive process to WebSocket."""
    shell = "powershell.exe"
    try:
        proc = await asyncio.create_subprocess_exec(
            shell,
            "-NoLogo",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except Exception as exc:
        await websocket.send_text(f"\r\n\x1b[31m[PowerShell 启动失败] {exc}\x1b[0m\r\n")
        await asyncio.sleep(2)
        return

    stop_event = asyncio.Event()

    async def read_stdout() -> None:
        while not stop_event.is_set():
            try:
                if proc.stdout is None:
                    break
                data = await proc.stdout.read(2048)
                if not data:
                    break
                await websocket.send_bytes(data)
            except Exception:
                break
        stop_event.set()

    async def read_stderr() -> None:
        while not stop_event.is_set():
            try:
                if proc.stderr is None:
                    break
                data = await proc.stderr.read(2048)
                if not data:
                    break
                await websocket.send_bytes(data)
            except Exception:
                break
        stop_event.set()

    async def write_stdin() -> None:
        while not stop_event.is_set():
            try:
                message = await websocket.receive()
                if message.get("type") == "websocket.disconnect":
                    break
                text = message.get("text")
                raw_bytes = message.get("bytes")
                if text:
                    if text.startswith("{") and text.endswith("}"):
                        try:
                            payload = json.loads(text)
                            if payload.get("type") == "resize":
                                continue
                            if payload.get("type") == "ping":
                                await websocket.send_text('{"type":"pong"}')
                                continue
                        except Exception:
                            pass
                    if proc.stdin:
                        proc.stdin.write(text.encode("utf-8", errors="replace"))
                        await proc.stdin.drain()
                elif raw_bytes and proc.stdin:
                    proc.stdin.write(raw_bytes)
                    await proc.stdin.drain()
            except Exception:
                break
        stop_event.set()

    tasks = [
        asyncio.create_task(read_stdout()),
        asyncio.create_task(read_stderr()),
        asyncio.create_task(write_stdin()),
    ]
    await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    stop_event.set()
    for t in tasks:
        t.cancel()
    try:
        proc.terminate()
    except Exception:
        pass


async def _handle_local_pty_terminal(
    websocket: WebSocket,
    cols: int,
    rows: int,
) -> None:
    """Bridge a local interactive PTY shell (Master container / Linux host) to WebSocket."""
    if os.name == "nt":
        await _handle_windows_process_terminal(websocket, cols, rows)
        return

    import pty

    master_fd, slave_fd = pty.openpty()
    import fcntl
    import struct
    import termios

    winsize = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)

    shell = os.environ.get("SHELL") or "/bin/bash"
    if not os.path.exists(shell):
        shell = "/bin/sh"

    pid = os.fork()
    if pid == 0:
        os.close(master_fd)
        os.setsid()
        os.dup2(slave_fd, 0)
        os.dup2(slave_fd, 1)
        os.dup2(slave_fd, 2)
        if slave_fd > 2:
            os.close(slave_fd)
        os.environ["TERM"] = "xterm-256color"
        os.environ["COLORTERM"] = "truecolor"
        os.execv(shell, [shell, "-l"])

    os.close(slave_fd)
    loop = asyncio.get_running_loop()
    stop_event = asyncio.Event()

    async def read_from_pty() -> None:
        while not stop_event.is_set():
            try:
                r, _, _ = await loop.run_in_executor(None, select.select, [master_fd], [], [], 0.05)
                if r:
                    data = os.read(master_fd, 4096)
                    if not data:
                        break
                    await websocket.send_bytes(data)
                else:
                    await asyncio.sleep(0.01)
            except Exception:
                break
        stop_event.set()

    async def write_to_pty() -> None:
        while not stop_event.is_set():
            try:
                message = await websocket.receive()
                if message.get("type") == "websocket.disconnect":
                    break
                text = message.get("text")
                raw_bytes = message.get("bytes")
                if text:
                    if text.startswith("{") and text.endswith("}"):
                        try:
                            payload = json.loads(text)
                            if payload.get("type") == "resize":
                                new_cols = int(payload.get("cols", cols))
                                new_rows = int(payload.get("rows", rows))
                                winsize = struct.pack("HHHH", new_rows, new_cols, 0, 0)
                                fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)
                                continue
                            if payload.get("type") == "ping":
                                await websocket.send_text('{"type":"pong"}')
                                continue
                        except Exception:
                            pass
                    os.write(master_fd, text.encode("utf-8"))
                elif raw_bytes:
                    os.write(master_fd, raw_bytes)
            except Exception:
                break
        stop_event.set()

    try:
        reader_task = asyncio.create_task(read_from_pty())
        writer_task = asyncio.create_task(write_to_pty())
        await asyncio.wait([reader_task, writer_task], return_when=asyncio.FIRST_COMPLETED)
        stop_event.set()
        reader_task.cancel()
        writer_task.cancel()
    finally:
        try:
            os.close(master_fd)
        except Exception:
            pass
        try:
            import signal

            os.kill(pid, signal.SIGTERM)
        except Exception:
            pass


@router.websocket("/{machine_id}/terminal/ws")
async def machine_terminal_websocket(
    websocket: WebSocket,
    machine_id: str,
    cols: int = 80,
    rows: int = 24,
    token: str | None = None,
) -> None:
    """Establish real-time full-duplex PTY WebSocket terminal session."""
    settings: Settings = websocket.app.state.settings
    services: Any = websocket.app.state.services

    # 1. Resolve Auth
    try:
        auth_token = (
            token
            or websocket.query_params.get("token")
            or websocket.headers.get("x-api-key")
        )
        resolve_principal(settings, services, auth_token)
    except Exception as exc:
        logger.warning("WebSocket authentication failed for machine %s: %s", machine_id, exc)
        await websocket.close(code=4401, reason="Unauthorized")
        return

    # 2. Lookup Machine
    machine = None
    if machine_id != "master-local":
        machine = services.machine_repository.get(machine_id)
        if not machine:
            await websocket.close(code=4404, reason="Machine not found")
            return

    await websocket.accept()

    try:
        if machine_id == "master-local" or (machine and machine.connection_type == "builtin"):
            await _handle_local_pty_terminal(websocket, cols, rows)
        elif machine:
            await _handle_ssh_terminal(websocket, services, machine, cols, rows)
        else:
            await websocket.send_text(
                "\r\n\x1b[31m[Error] Unsupported machine connection.\x1b[0m\r\n"
            )
    except WebSocketDisconnect:
        logger.info("WebSocket terminal disconnected for machine %s", machine_id)
    except Exception as exc:
        logger.error("Terminal session error on %s: %s", machine_id, exc, exc_info=True)
        try:
            await websocket.send_text(f"\r\n\x1b[31m[Session Error] {exc}\x1b[0m\r\n")
        except Exception:
            pass
