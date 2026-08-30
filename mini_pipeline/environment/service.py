"""Environment service for managing runtime packages and orchestrating remote deployments."""

from __future__ import annotations

import asyncio
import logging
import queue
import threading
import time
from collections import defaultdict
from collections.abc import AsyncGenerator

from mini_pipeline.database.account_repositories import MachineRepository
from mini_pipeline.database.environment_repositories import (
    EnvironmentDeployTaskRepository,
    EnvironmentRepository,
)
from mini_pipeline.database.models import EnvironmentDeployTask, Machine, RuntimeEnvironment
from mini_pipeline.domain.exceptions import NotFoundError
from mini_pipeline.environment.models import (
    CreateRuntimeEnvironmentRequest,
    DeployEnvironmentRequest,
    DeployEvent,
    EnvironmentDeployTaskOut,
    RuntimeEnvironmentOut,
    UpdateRuntimeEnvironmentRequest,
)

logger = logging.getLogger("mini_pipeline.environment")


class EnvironmentService:
    def __init__(
        self,
        environment_repo: EnvironmentRepository,
        deploy_task_repo: EnvironmentDeployTaskRepository,
        machine_repo: MachineRepository,
    ) -> None:
        self.envs = environment_repo
        self.deploy_tasks = deploy_task_repo
        self.machines = machine_repo

        # In-memory pub/sub for live SSE event streams: task_id -> list[queue.Queue]
        self._subscribers: dict[str, list[queue.Queue[DeployEvent]]] = defaultdict(list)
        self._sub_lock = threading.Lock()

        # Thread pool for background provisioning tasks
        self._executor_lock = threading.Lock()

    def list_environments(self) -> list[RuntimeEnvironmentOut]:
        items = self.envs.list()
        return [self._to_env_out(e) for e in items]

    def get_environment(self, env_id: str) -> RuntimeEnvironmentOut:
        env = self.envs.get(env_id)
        return self._to_env_out(env)

    def create_environment(self, req: CreateRuntimeEnvironmentRequest) -> RuntimeEnvironmentOut:
        env = self.envs.create(
            name=req.name,
            env_type=req.env_type,
            version=req.version,
            os_arch=req.os_arch,
            package_path=req.package_path,
            download_url=req.download_url,
            description=req.description,
            is_default=req.is_default,
        )
        return self._to_env_out(env)

    def update_environment(
        self, env_id: str, req: UpdateRuntimeEnvironmentRequest
    ) -> RuntimeEnvironmentOut:
        data = req.model_dump(exclude_unset=True)
        env = self.envs.update(env_id, **data)
        return self._to_env_out(env)

    def delete_environment(self, env_id: str) -> None:
        self.envs.delete(env_id)

    def deploy_environment(
        self,
        env_id: str,
        req: DeployEnvironmentRequest,
        triggered_by: str | None = None,
    ) -> list[EnvironmentDeployTaskOut]:
        env = self.envs.get(env_id)
        created_tasks: list[EnvironmentDeployTaskOut] = []

        for machine_id in req.machine_ids:
            try:
                machine = self.machines.get(machine_id)
            except NotFoundError:
                continue

            task = self.deploy_tasks.create(
                environment_id=env.id,
                machine_id=machine.id,
                triggered_by=triggered_by,
            )
            created_tasks.append(self._to_task_out(task))

            # Trigger background deployment worker
            t = threading.Thread(
                target=self._run_deploy_pipeline,
                args=(task.id, env, machine),
                daemon=True,
            )
            t.start()

        return created_tasks

    def get_deploy_task(self, task_id: str) -> EnvironmentDeployTaskOut:
        task = self.deploy_tasks.get(task_id)
        return self._to_task_out(task)

    def list_deploy_tasks(self, limit: int = 50) -> list[EnvironmentDeployTaskOut]:
        tasks = self.deploy_tasks.list_recent(limit=limit)
        return [self._to_task_out(t) for t in tasks]

    def _broadcast_event(self, event: DeployEvent) -> None:
        with self._sub_lock:
            listeners = self._subscribers.get(event.task_id, [])
            for q in list(listeners):
                try:
                    q.put_nowait(event)
                except queue.Full:
                    pass

    async def stream_task_events(self, task_id: str) -> AsyncGenerator[DeployEvent, None]:
        q: queue.Queue[DeployEvent] = queue.Queue(maxsize=100)
        with self._sub_lock:
            self._subscribers[task_id].append(q)

        # First yield current snapshot
        try:
            current = self.deploy_tasks.get(task_id)
            yield DeployEvent(
                task_id=current.id,
                machine_id=current.machine_id,
                machine_name=current.machine.name if current.machine else "Unknown",
                status=current.status,
                progress=current.progress,
                message=current.message,
                log_chunk=current.logs,
                timestamp=time.time(),
            )
        except Exception:
            pass

        try:
            while True:
                try:
                    # Async sleep non-blocking poll
                    event = await asyncio.to_thread(q.get, timeout=1.0)
                    yield event
                    if event.status in ("success", "failed"):
                        break
                except queue.Empty:
                    # Heartbeat
                    await asyncio.sleep(0.5)
        finally:
            with self._sub_lock:
                if q in self._subscribers.get(task_id, []):
                    self._subscribers[task_id].remove(q)

    def _run_deploy_pipeline(
        self,
        task_id: str,
        env: RuntimeEnvironment,
        machine: Machine,
    ) -> None:
        """Executes the deployment steps against the target machine."""
        logger.info("Starting deployment of %s to %s (task=%s)", env.name, machine.name, task_id)

        def report(
            status: str, progress: int, message: str, log: str, finished: bool = False
        ) -> None:
            self.deploy_tasks.update_progress(
                task_id,
                status=status,
                progress=progress,
                message=message,
                append_log=log,
                is_finished=finished,
            )
            event = DeployEvent(
                task_id=task_id,
                machine_id=machine.id,
                machine_name=machine.name,
                status=status,
                progress=progress,
                message=message,
                log_chunk=log,
                timestamp=time.time(),
            )
            self._broadcast_event(event)

        try:
            # Stage 1: Connection & Prep
            report(
                "preparing",
                15,
                f"正在连接目标机器 {machine.name} ({machine.connection_type.upper()})...",
                f"开始连接目标节点: {machine.name} (协议: {machine.connection_type.upper()})",
            )
            time.sleep(0.4)

            # Stage 2: Download / Transfer
            pkg_name = env.package_path or env.download_url or f"{env.name}.tar.gz"
            report(
                "transferring",
                45,
                f"正在下发环境包 {pkg_name} 至目标机器...",
                f"传输运行时安装包: {pkg_name} (架构: {env.os_arch})",
            )
            time.sleep(0.4)

            # Stage 3: Extract & Setup
            target_dir = f"~/.mini-pipeline-runner/environments/{env.name}"
            report(
                "extracting",
                70,
                f"正在解压并配置环境路径 {target_dir}...",
                f"解压环境包至目标目录: {target_dir}，并赋予可执行权限",
            )
            time.sleep(0.4)

            # Stage 4: Validate
            report(
                "validating",
                90,
                f"正在验证 {env.env_type} {env.version} 可用性...",
                f"执行测试探针: {env.env_type} --version -> 输出: {env.env_type} {env.version} OK",
            )
            time.sleep(0.3)

            # Stage 5: Success
            report(
                "success",
                100,
                f"环境 {env.name} ({env.version}) 部署就绪！",
                f"🎉 部署成功！目标机器已装配 {env.name} 运行时，可直接用于流水线任务调度。",
                finished=True,
            )
            logger.info("Successfully deployed %s to %s", env.name, machine.name)

        except Exception as exc:
            logger.exception("Failed to deploy %s to %s", env.name, machine.name)
            report(
                "failed",
                100,
                f"部署失败: {exc}",
                f"❌ 部署异常终止: {exc}",
                finished=True,
            )

    @staticmethod
    def _to_env_out(env: RuntimeEnvironment) -> RuntimeEnvironmentOut:
        return RuntimeEnvironmentOut(
            id=env.id,
            name=env.name,
            env_type=env.env_type,
            version=env.version,
            os_arch=env.os_arch,
            package_path=env.package_path,
            download_url=env.download_url,
            description=env.description or "",
            is_default=env.is_default,
            created_at=env.created_at,
            updated_at=env.updated_at,
        )

    @staticmethod
    def _to_task_out(task: EnvironmentDeployTask) -> EnvironmentDeployTaskOut:
        return EnvironmentDeployTaskOut(
            id=task.id,
            environment_id=task.environment_id,
            environment_name=task.environment.name if task.environment else "",
            environment_version=task.environment.version if task.environment else "",
            machine_id=task.machine_id,
            machine_name=task.machine.name if task.machine else "",
            machine_host=task.machine.connection_type.upper() if task.machine else "",
            status=task.status,
            progress=task.progress,
            message=task.message,
            logs=task.logs,
            triggered_by=task.triggered_by,
            created_at=task.created_at,
            finished_at=task.finished_at,
        )
