# AGENTS.md

`Mini Pipeline` — FastAPI + React 流水线执行平台。完整上下文见 `CLAUDE.md`。

## 必须设置的环境变量和命令

```bash
# Python 虚拟环境（运行任何命令前必须先 source）
# Linux/macOS: . .venv/bin/activate ；Windows Git Bash: . .venv/Scripts/activate
pip install -e '.[dev]'

# 必须设置：不设的话服务端和测试都无法启动
export MINI_PIPELINE_CONFIG=config/default.yaml

# 后端（Windows Git Bash 用 .venv/Scripts/python 代替 .venv/bin/python）
.venv/bin/pytest -q                                          # 跑全部测试（不能用 bare `pytest`）
.venv/bin/pytest tests/integration/test_v2_full_demo.py -q   # 跑单个集成测试
.venv/bin/ruff check .                                       # 代码检查

# 数据库迁移（生产/升级路径；开发 SQLite 由 create_all 自动建表）
alembic upgrade head

# 保留策略 GC（可先 --dry-run 预览）
mini-pipeline-gc

# 前端
cd frontend
npm install --legacy-peer-deps          # --legacy-peer-deps 是必须的，不能省略
npm run typecheck                       # tsc --noEmit（strict 模式，noExplicitAny 是 error）
npm run lint                            # eslint --max-warnings=0
npm run build                           # typecheck + vite build
```

一键全量验证：`scripts/check.sh`（ruff + pytest + 前端三件套，自动适配 Windows/Linux venv 布局）。

## 容易踩的坑

- **配置文件中的环境变量展开是严格的**：YAML 里的 `${VAR}` 如果没设置，启动直接拒绝。`.env.example` 展示了需要的变量（含 docker.yaml 的鉴权 token 三件套）。
- **集成测试需要设置 `MINI_PIPELINE_CONFIG`**。`conftest.py` 提供了 `settings`、`client`、`plugin_zip` 三个共享 fixture。
- **示例插件的 run.sh 必须在集成测试引用之前 `chmod +x`**。
- **测试脚本里调用 Python 要做可用性探测**：Windows 上 `python3` 可能是 Microsoft Store 的坏 stub（退出码 9009）。集成测试中的 shell 脚本统一用 `for c in python3 python; do ... done` 探测循环。
- **Windows 不保留 POSIX 执行位**：断言 mode/exec bit 的测试要 `skipif(sys.platform == "win32")`。
- **Shell Runtime 没有隔离**。生产环境需要用 Docker/K8s Runtime（见 `docs/roadmap.md`）。
- **TypeScript `noExplicitAny` 是 error**，不是 warn。必须用正确的类型，或用 `unknown` + 类型收窄。
- **`@/*` 路径别名** 解析到 `src/*`（TypeScript 和 Vite 都生效）。
- **前端开发代理**：`/api` 和 `/health` → `http://127.0.0.1:8000`，可通过 `VITE_API_TARGET` 覆盖。
- **Docker**：以非 root 的 `pipeline` 用户运行（UID 10001）。PostgreSQL 通过 `docker-compose.yml` 配置；容器 entrypoint 自动 `alembic upgrade head`。
- **列表接口是分页信封**：`{items,total,page,page_size,pages}`（page_size 上限 200）。别再当裸数组消费。
- **鉴权开启后的测试**：默认配置 `auth.enabled: false`（匿名 admin）。开启后所有 `/api` 请求要 `Authorization: Bearer mpt_…`；`/api/auth/{mode,register,login}` 是公开路由；runner 端点用 `mrt_` 机器令牌，与用户令牌不通用。
- **远程执行测试**：目标机器的任务先变 `QUEUED`（协调器是异步的），测试要轮询等待后再 claim；owner 为 NULL 的资源是平台资源（全员可见），新注册用户的资源默认私有。

## Agent 容易忽略的架构细节

- **双线程池**：`coordinator_workers`（默认 2）推进 DAG；`task_workers`（默认 4）执行具体步骤。排查死锁时优先看这里。
- **取消是进程树级的**：`engine.cancellations`（run_id → `threading.Event`）→ `ProcessRunner` 轮询事件并整树终止（POSIX `killpg` / Windows `taskkill /T`）。`CANCELLED` 是 run 与 task 的正式终态。
- **重试语义**：step 的 `retries: n` 表示失败后最多再跑 n 次（总共 n+1 次）；退避 `retry_backoff_seconds × 2^(attempt-1)` 上限 60s；`task.attempt` 持久化（从 1 开始）。
- **SSE 三个流**：`/api/runs/{id}/events`（`snapshot` + `event`，run 终态后服务端关流）、`/api/runs/{id}/tasks/{step}/log/stream`（`log` + `end`）。前端 hooks：`useRunEventStream`、`useLogStream`。反代必须关缓冲（后端已发 `X-Accel-Buffering: no`）。
- **v1 插件协议兼容层**：执行器同时写 `input.json`（params = 运行级参数 ∪ 步骤解析参数）与 `input/` 目录树；同时读 `output.json`（status/outputs/artifacts 合并进 v2 收集结果，契约声明优先）。
- **JSON 输出双地址**：v2 契约中 type=json 的输出，顶层键会合并进 task outputs（资源名键优先），下游 `${{ steps.x.outputs.<key> }}` 可直达。
- **v1 manifest 自动升级**：通过 `mini_pipeline/plugin/manifest.py` 里的 `_upgrade_v1_to_v2`，旧的 flat inputs/outputs 会自动转为 v2 契约（输出路径为 `output/<name>`）。
- **表达式解析器**只允许 3 种访问路径：`params.<k>`、`steps.<dep>.outputs.<k>`、`all.deps.outputs.<k>`。其他写法都会抛异常。
- **工作目录布局是固定的**：`workspace/{input,output,temp,cache,logs}` + `context.json` + `params.json` + `input.json`。每次重试执行前 workspace 会被清空重建——跨重试的状态要放 workspace 之外。
- **产物下载是不透明引用**：API 使用 `artifact_id`，绝不暴露文件系统路径；响应带 sha256 ETag（条件请求 304）。
- **启动即收割孤儿 run**：进程内线程池不持久化，重启后遗留 PENDING/RUNNING 的 run 会被标记 FAILED（`execution.reap_orphans_on_start`）。断点续跑语义用 branch run。
- **`toolhub/` 与 Pipeline 已打通**：toolhub 用 `plugin.yaml` 描述工具，与 Pipeline 插件格式兼容。Pipeline 的 `source/toolhub.py` 提供 toolhub source type，可从 toolhub 的 `index.json` 注册插件（配置 `hub`/`tool`/`channel`/`version`/`auth`）。修改 toolhub 代码时注意它内部用极简 YAML 解析器（`publish/parse_yaml.py`），无 PyYAML 依赖。

## 没有 CI/CD，也没有 pre-commit

本项目没有 GitHub Actions、没有 GitLab CI、没有 pre-commit hooks、也没有 Makefile。每次修改代码后，必须手动依次跑 `ruff check`、`npm run typecheck` 和 `npm run lint`（或直接 `scripts/check.sh`）。
