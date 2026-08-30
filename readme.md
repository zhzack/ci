# Mini Pipeline

**轻量级流水线执行平台** —— 插件只是普通进程，流水线只是一个 YAML DAG。

| | |
| --- | --- |
| 当前版本 | `0.3.0`（变更明细见 [CHANGELOG](CHANGELOG.md)） |
| 后端 | Python 3.9+ · FastAPI · SQLAlchemy 2 · Pydantic v2 |
| 前端 | React 19 · Vite · TypeScript strict · Ant Design 5 |
| 存储 | SQLite（零配置开发）/ PostgreSQL 16（Docker Compose 生产） |
| 用户与团队 | 账户注册/登录（首位用户自动为 Admin）、团队（Teams）管理、资源团队级共享 |
| 远程执行 | 多机网络：Pull 模式 Runner Agent（一键安装）+ SSH 直连免 Agent 模式 |
| 部署体系 | 本地运行 / Docker 双环境（开发热重载 + 生产 Nginx）/ 非源码离线发布 |

Mini Pipeline 把「跑一条流水线」拆成三个正交的部分：

- **插件（Plugin）**：任意可执行程序 + 一份 `plugin.yaml` 声明契约（输入/输出/产物）。平台按契约把输入放到位、把输出收回来，插件本身不需要任何 SDK；
- **流水线（Pipeline）**：一个 YAML 文件描述 DAG。步骤间通过 `${{ }}` 表达式接线，无依赖的步骤自动并行；
- **运行（Run）**：一次执行实例。平台负责调度、实时日志、取消、重试、产物收集与历史管理。

## 目录

- [特性总览](#特性总览)
- [快速开始](#快速开始)
- [插件规范](#插件规范)
- [Pipeline 规范](#pipeline-规范)
- [运行管理](#运行管理)
- [鉴权与安全](#鉴权与安全)
- [REST API 摘要](#rest-api-摘要)
- [配置参考](#配置参考)
- [可观测性与运维](#可观测性与运维)
- [前端管理后台](#前端管理后台)
- [测试](#测试)
- [项目结构](#项目结构)
- [文档索引](#文档索引)

## 特性总览

**执行**

- 四种 Runtime：`shell` / `python` / `node` / `executable`（`docker` 已在契约校验中预留，实现见 [roadmap](docs/roadmap.md)）；
- 墙钟超时、进程树终止（POSIX `killpg` / Windows `taskkill /T`）、Windows 下自动解析 shebang 经 Git Bash 执行；
- Step 级自动重试：`retries: n`，指数退避（基数 `retry_backoff_seconds`，单次上限 60s），`attempt` 持久化；
- 运行取消：`POST /api/runs/{id}/cancel`，运行中插件进程整树终止，未开始步骤置 `CANCELLED`；
- Branch run：从任意 step 分支重跑，复用上游已成功的输出。

**实时**

- `GET /api/runs/{id}/events`：run/task 状态 SSE 事件流（事件总线直推 + 周期性 DB 快照兜底，终态后服务端关流）；
- `GET /api/runs/{id}/tasks/{step}/log/stream`：任务日志 SSE tail 流（`log` + `end` 事件）。

**分布式远程执行**

- **双模式调度**：
  - **Pull 模式 Runner Agent**：基于出站 HTTP 长轮询原子认领任务，支持 15 秒心跳续租与孤儿租约收割（`LeaseReaper`）；
  - **Push 模式 SSH 直连**：免装 Agent，通过 Paramiko SFTP 打包下发与远程命令执行，支持机器实时连通性探测；
- **单指令自适应部署（`/install`）**：针对 Linux Shell 与 Windows PowerShell 自动下发单行安装脚本，带 Token 自动后台拉起；
- **机器分类管理**：个人机（个人接入/共享）与管理员机池（平台持有分配，机密凭证 Fernet 对称加密）。

**多用户与团队协同**

- **动态用户与认证体系**：密码 `scrypt` 加盐哈希安全存储，**系统首位注册用户自动成为超级管理员**；
- **团队（Teams）全功能管理**：团队创建、成员管理，支持将流水线与机器批量共享给指定团队或个人（viewer / operator 权限细分）；
- **操作审计**：关键变更与管理操作统一沉淀 `audit_logs` 审计追踪。

**平台底座**

- 插件注册五通道：Git / HTTP ZIP / 上传 ZIP / 文件夹上传 / toolhub 制品仓；
- 鉴权：动态 Session Token（`mpt_...`）+ 静态 API Token（Bearer / X-API-Key）+ `admin` / `reader` 角色；
- 可观测：`/health`（liveness）、`/health/ready`（readiness）、`/health/version`、`/metrics`（Prometheus）、text/JSON 结构化日志 + 全链路 RequestID；
- API 工程化：统一分页信封、写方法滑动窗口限流、CORS、GZip、OpenAPI tag 元数据；
- 可靠性：Alembic 迁移、启动孤儿收割（崩溃恢复）、保留策略 GC（`mini-pipeline-gc`）；
- 产物：sha256 ETag / `If-None-Match` 304 条件下载，API 不暴露文件系统路径。

## 快速开始

### 后端

需要 Python 3.9+；Git 来源注册需要系统安装 `git`；Windows 上执行 Shell 插件需要 Git Bash。

```bash
python -m venv .venv
# Linux/macOS:  . .venv/bin/activate
# Windows Git Bash:  . .venv/Scripts/activate
pip install -e '.[dev]'

export MINI_PIPELINE_CONFIG=config/default.yaml
uvicorn mini_pipeline.server.app:app --reload
```

| 地址 | 说明 |
| --- | --- |
| <http://127.0.0.1:8000/api> | REST API 前缀 |
| <http://127.0.0.1:8000/docs> | Swagger UI（含 tag 分组与鉴权说明） |
| <http://127.0.0.1:8000/health> | 健康检查 |

默认数据写入 `./data`（SQLite）。开发模式鉴权关闭（`auth.enabled: false`），所有请求视为匿名 admin。

### 前端

```bash
cd frontend
npm install --legacy-peer-deps     # --legacy-peer-deps 是必须的，不能省略
npm run dev                        # http://127.0.0.1:5173
```

Vite 将 `/api` 与 `/health` 代理到 `http://127.0.0.1:8000`（`VITE_API_TARGET` 可覆盖）。

### Docker Compose 双环境支持

项目提供两套开箱即用的 Docker Compose 环境：

#### 1. 正式发布版（Production，全容器打包 + Nginx 网关）
包含完整构建的前端静态资源、Nginx 反向代理、生产后端与 PostgreSQL 16，无需宿主机安装任何 Node 或 Python 环境：
```bash
cp .env.example .env               # 填入鉴权 token 三件套与端口配置
docker compose up -d --build       # 后台启动
curl http://127.0.0.1/health       # 浏览器打开 http://localhost （默认 80 端口）
```

#### 2. 开发热重载版（Development，目录源码映射 + 实时热更新）
前后端通过卷映射（Volume Mount）实时同步宿主机源码。后端改动自动触发 Uvicorn 重载，前端改动自动触发 Vite HMR 毫秒级热更新：
```bash
docker compose -f docker-compose.dev.yml up -d --build
# 前端热重载地址：http://localhost:5173
# 后端 API 地址：  http://localhost:8000
# 数据库直连调试：localhost:5432
```

#### 3. 非源码生产交付（面向运维与无源码部署）
交付给运维人员时无需提供业务源码，可直接交付预构建镜像包或私有镜像仓库拉取：
- **研发一键打包产物包**：
  ```bash
  python scripts/package_release.py --version 0.3.0 --include-images
  ```
- **运维一键单机/多机部署**：使用 `deploy/` 下的纯镜像编排与脚本，详见 [非源码部署与运维指南](docs/deploy/非源码部署指南.md)。

生产部署与运维操作见 [docs/operations.md](docs/operations.md)。

## 插件规范

插件目录至少包含 `plugin.yaml` 与入口文件：

```text
hello/
├── plugin.yaml
└── run.sh
```

### 契约（plugin.yaml v2）

```yaml
name: hello
version: 1.0.0            # 必须是语义化版本
description: Generate a greeting
runtime:
  type: shell             # shell | python | node | executable
  entry: run.sh           # 默认 run.sh；必须位于插件目录内
contract:
  inputs:
    - {name: count, type: number, source: parameter, required: true, default: 10}
    - {name: config, type: file, source: url, target: input/config.json}
    - {name: image, type: file, source: upload, target: input/image.jpg}
    - {name: data, type: file, source: artifact, from: gen.dataset, target: input/data.json}
  outputs:
    - {name: report, type: file, path: output/report.json}
    - {name: stats, type: json, path: output/stats.json}
```

要点：

- **input 类型**：`string` / `number` / `boolean` / `json` / `file` / `directory` / `list`；
- **input 来源**：`parameter`（运行参数解析）、`upload`（随 run 上传）、`url`（平台下载）、`artifact`（`from: <dep>.<output>` 从上游产物复制）、`generated`；
- **v1 兼容**：旧的 flat `inputs:`/`outputs:` 写法加载时自动升级为 v2 契约（输出路径为 `output/<name>`），存量插件无需改造。

### 执行协议

每个 step 执行时，平台创建固定布局的工作目录并注入环境变量
`PIPELINE_CONTEXT`、`PIPELINE_WORKSPACE`、`PIPELINE_TASK_ID`、`MINI_PIPELINE_WORKSPACE`：

```text
workspace/
├── input/            # v2：按契约解析后的输入树
├── output/           # 插件把输出文件写这里
├── temp/  cache/  logs/
├── context.json      # run/task/workspace 元信息
├── params.json       # 解析后的参数
└── input.json        # v1 兼容：{task_id, workspace, params, dependencies}
```

- **v2 插件**：读 `input/` 目录树 + `context.json`，把输出写到 `output/`；type=json 且内容是对象的输出，其顶层键会同时合并进 task outputs（资源名优先），下游 `${{ steps.x.outputs.<key> }}` 可直达；
- **v1 插件**：读根目录 `input.json`（`params` = 运行级参数 ∪ 步骤解析参数），写 `output.json`（`{status, message, outputs, artifacts}`）。退出码 0 且 `status == success` 才算成功；
- 插件也可写 `error.json`（`{code, message, suggestion}`）提供更友好的失败信息；
- **每次重试前 workspace 会被清空重建**——跨重试的状态请放在 workspace 之外；
- 产物路径必须落在 workspace 内（防路径穿越），ZIP 注册有路径穿越/符号链接/大小/文件数多重校验。

> ⚠️ Shell 插件属于**受信代码**：平台做了路径、归档、超时与工作区保护，但没有容器级强隔离。不要注册不可信来源；不可信代码需要 Docker Runtime（见 [roadmap](docs/roadmap.md)）。

### 表达式

`with` 中支持四种白名单表达式（不执行任何 Python/Shell 代码）：

```yaml
with:
  name: "${{ params.who }}"                          # 运行参数
  result: "${{ steps.build.outputs.result }}"        # 上游输出
  values: "${{ all.deps.outputs.message }}"          # 所有依赖同名输出收集为数组（扇入）
  binary: "${{ steps.build.artifacts.app.path }}"    # 上游产物路径
```

整值只有一个表达式时保留 JSON 原类型；嵌入字符串时转为文本。

## Pipeline 规范

```yaml
name: demo-fan
params:                # 运行级参数默认值，可在提交运行时覆盖
  threshold: 0.5
steps:
  - name: gen
    plugin: num-gen@1.0.0          # 引用必须是 name@semver
  - name: double
    plugin: num-double@1.0.0
    depends: [gen]
    with:
      value: "${{ steps.gen.outputs.value }}"
  - name: triple
    plugin: num-triple@1.0.0
    depends: [gen]
    with:
      value: "${{ steps.gen.outputs.value }}"
  - name: sum
    plugin: num-sum@1.0.0
    depends: [double, triple]      # 扇入：等所有依赖成功才执行
    with:
      values: "${{ all.deps.outputs.result }}"
    retries: 2                     # 失败后按 2^n 秒退避自动重试（共执行 3 次）
```

状态机：

```text
Task:    PENDING → READY → RUNNING → SUCCESS
                           ├→ FAILED   (重试耗尽)
                           ├→ SKIPPED  (依赖失败/被跳过)
                           └→ CANCELLED (运行取消或依赖被取消)
Pipeline: PENDING → RUNNING → SUCCESS | FAILED | CANCELLED
```

依赖失败只阻断传递下游，互不依赖的分支继续执行。完整示例见
[examples/pipelines](examples/pipelines)（`demo-fan` 扇出扇入、`demo-chain` 链式）与
[examples/plugins](examples/plugins)（17 个示例插件）。

## 运行管理

```bash
# 提交运行（异步，返回 202 + run id）
curl -X POST http://127.0.0.1:8000/api/runs \
  -H 'Content-Type: application/json' \
  -d '{"pipeline": "demo-fan", "params": {"threshold": 0.8}}'

# 查询（含每个 step 的 outputs/artifacts/attempt）
curl http://127.0.0.1:8000/api/runs/$RUN_ID

# 实时状态流（SSE：snapshot + event，终态后服务端关流）
curl -N http://127.0.0.1:8000/api/runs/$RUN_ID/events

# 实时日志流（SSE：log + end）
curl -N http://127.0.0.1:8000/api/runs/$RUN_ID/tasks/gen/log/stream

# 取消（终止运行中的进程树；对终态 run 返回 409）
curl -X POST http://127.0.0.1:8000/api/runs/$RUN_ID/cancel

# 下载产物（响应带 sha256 ETag；If-None-Match 命中返回 304）
curl -OJ http://127.0.0.1:8000/api/runs/$RUN_ID/artifacts/$ARTIFACT_ID
```

带文件上传的运行用 `POST /api/runs/upload`（multipart，字段名对应 `source: upload` 的输入）。需要「只重跑某一步的下游」时用 branch run：

```bash
curl -X POST http://127.0.0.1:8000/api/runs/$RUN_ID/branches \
  -H 'Content-Type: application/json' \
  -d '{"from_step": "sum", "params": {}}'
```

## 鉴权与安全

平台采用 **动态用户会话（Session Token）** 与 **静态密钥（API Token）** 双轨安全认证：

### 1. 动态用户体系
- **首位用户 Bootstrap**：全新安装的系统中，**首个注册的用户自动成为超级管理员（Admin）**，拥有平台所有管理特权；
- **密码安全哈希**：基于 `scrypt` 算法（N=16384, r=8, p=1）+ 随机盐哈希，数据库绝不落地明文；
- **会话机制**：登录成功下发 `mpt_...` 会话令牌（数据库仅存储 SHA-256 哈希），有效期由 `auth.session_ttl_hours`（默认 72h）控制；
- **注册保护**：生产环境下管理员完成初始化后，可在配置中将 `auth.registration_enabled` 设为 `false` 关闭前台自由注册。

### 2. 静态 API Token（供自动化脚本调用）
配置在 YAML 中的静态密钥（从环境变量读取）：
```yaml
auth:
  enabled: true
  tokens:
    - {token: ${MINI_PIPELINE_ADMIN_TOKEN}, name: admin, role: admin}
    - {token: ${MINI_PIPELINE_READER_TOKEN}, name: ci, role: reader}
```
- 请求头携带 `Authorization: Bearer <token>` 或 `X-API-Key: <token>`，常数时间比对；
- `reader` 只能调用只读接口；`admin` 拥有完全控制权（`/api/debug/**`、`/api/admin/**` 仅 admin 可达）。

### 3. 团队与资源共享（Grants）
- 流水线、插件与机器均具备属主（`owner_id`），他人资源默认对未授权者返回 404 防止存在性探测；
- 属主与管理员可通过授权接口（`POST /api/grants`）将资源授权给特定用户（`grantee_type: "user"`）或团队（`grantee_type: "team"`），支持 `viewer` 与 `operator` 权限粒度。

### 4. 机密保护与接口限流
- **凭证静态加密**：管理员机器的 SSH/Agent 密码通过 Fernet（`security.secret_key`）对称加密存储，普通用户跑任务无法解密明文；
- **滑动窗口限流**：`security.rate_limit_per_minute` 对写操作按 IP 限流（429 + `Retry-After`）；
- **追踪审计**：每个请求注入 16 位 `X-Request-ID`，关键 mutating 操作写入 `audit_logs` 审计表。

## REST API 摘要

所有列表接口返回统一分页信封：`{items, total, page, page_size, pages}`（`page_size` 上限 200）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` · `/health/ready` · `/health/version` | 存活 / 就绪 / 版本探针 |
| GET | `/metrics` | Prometheus 指标（`observability.metrics_enabled` 可关闭） |
| POST | `/api/plugins/register` | 从 Git / HTTP / toolhub 注册 |
| POST | `/api/plugins/upload` · `/api/plugins/upload-folder` | ZIP / 文件夹上传注册 |
| GET | `/api/plugins` | 插件版本列表（分页，支持 `search`） |
| GET | `/api/plugins/{name}/{version}` · `…/manifest` | 详情 / 解析后契约 |
| DELETE | `/api/plugins/{name}/{version}` | 删除版本 |
| POST | `/api/pipelines` · `/api/pipelines/yaml` | 创建 Pipeline（JSON / raw YAML） |
| GET | `/api/pipelines` | 列表（分页） |
| GET · PUT · DELETE | `/api/pipelines/{id-or-name}` | 原始 YAML 的读 / 更新 / 删除 |
| GET | `/api/pipelines/{id-or-name}/params-schema` | Run 表单 / 可视化编辑器 schema |
| POST | `/api/pipelines/validate` | 接线校验报告 |
| POST | `/api/runs` | 异步提交运行（202） |
| POST | `/api/runs/upload` | 带文件上传提交运行 |
| GET | `/api/runs` | 运行历史（分页，`status` / `pipeline` 过滤） |
| GET | `/api/runs/{id}` | 运行详情（含 tasks / outputs / attempt） |
| POST | `/api/runs/{id}/cancel` | 取消运行 |
| POST | `/api/runs/{id}/branches` | Branch run |
| GET | `/api/runs/{id}/tasks/{step}/log` | 任务日志全文 |
| GET | `/api/runs/{id}/tasks/{step}/log/stream` | 任务日志 SSE 流 |
| GET | `/api/runs/{id}/events` | run/task 状态 SSE 流 |
| GET | `/api/runs/{id}/aggregated-log` | 全步骤聚合日志 |
| GET | `/api/runs/{id}/artifacts/{artifact}` | 产物下载（sha256 ETag / 304） |
| GET | `/api/artifacts` | 产物目录（分页，可按 `run_id` 过滤） |
| GET | `/api/dashboard/summary` | Dashboard 统计 |
| GET | `/api/debug/**` | 原始状态巡检（仅 admin） |

## 配置参考

`MINI_PIPELINE_CONFIG` 指向 YAML（默认 `config/default.yaml`）。YAML 内 `${ENV}` 严格展开，变量缺失服务拒绝启动（这是有意的防爆设计；所需变量见 `.env.example`）。

| 键 | 说明 |
| --- | --- |
| `app.{host,port,api_prefix}` | 服务监听与 API 前缀 |
| `database.{url,echo}` | SQLAlchemy URL（SQLite / PostgreSQL） |
| `storage.{root,plugins,workspaces,logs,artifacts,temp}` | 文件布局 |
| `execution.coordinator_workers` | DAG coordinator 线程数（默认 2） |
| `execution.task_workers` | 任务执行线程数（默认 4） |
| `execution.task_timeout_seconds` | 单任务超时（默认 3600） |
| `execution.reap_orphans_on_start` | 启动时收割 PENDING/RUNNING 遗留 run（默认 true） |
| `execution.retry_backoff_seconds` | 重试退避基数（默认 2，指数增长上限 60s） |
| `logging.{level,format}` | 日志级别；`format: text \| json` |
| `observability.metrics_enabled` | 是否暴露 `/metrics` |
| `auth.{enabled,tokens}` | 鉴权开关与 token 表 |
| `security.{cors_origins,rate_limit_per_minute}` | CORS 白名单；写方法限流（0 关闭） |
| `retention.{workspaces_days,logs_days,artifacts_days,temp_hours}` | 保留策略（0 = 永久） |
| `sources.{http_timeout_seconds,max_archive_bytes,max_extracted_bytes,max_archive_files}` | 插件来源下载限制 |

## 可观测性与运维

**健康检查**：`/health`（liveness，不触碰依赖）与 `/health/ready`（readiness：DB 连通、存储可写、dispatcher 收单，失败 503）。K8s 探针按此二分；docker-compose 已内置 API 容器健康检查。

**指标**（`/metrics`）：`mini_pipeline_http_requests_total`、`mini_pipeline_http_request_duration_seconds`（route 模板级 label，无基数爆炸）、`mini_pipeline_runs_total{status}`、`mini_pipeline_task_duration_seconds{plugin}`、`mini_pipeline_task_retries_total{plugin}`。

**日志**：`format: text`（开发）或 `json`（生产）；每行含 `request_id`。任务日志按 `logs/<run-id>/<task-id>.log` 实时落盘。

**数据库迁移**：开发 SQLite 由 `create_all` 引导；生产升级执行 `alembic upgrade head`（容器 entrypoint 自动）。生成新迁移：`alembic revision --autogenerate -m "..."`。

**崩溃恢复**：进程内线程池不持久化，服务重启时遗留 PENDING/RUNNING 的 run 被标记 FAILED（message 注明重启中断）；需要「断点续跑」语义用 branch run 复用上游结果。

**保留策略 GC**：

```bash
mini-pipeline-gc --dry-run --verbose   # 预览
mini-pipeline-gc                       # 按 retention.* 清理 workspace/日志/产物/DB 记录
```

排障速查与生产部署细节见 [docs/operations.md](docs/operations.md)。

## 前端管理后台

`frontend/` 是独立的 React 19 + Vite + AntD 5 工程，页面覆盖：Dashboard、插件（列表/注册/详情）、Pipeline（列表/创建/可视化编辑/详情/历史）、运行（进行中/历史/详情）、产物、设置。

- 远端数据全部走 TanStack Query；列表页为服务端分页 + 过滤；
- 运行详情页通过 SSE 实时刷新（live 标记），日志走 SSE tail 流；支持运行取消（二次确认）与 Branch run；
- 暗色主题（AntD darkAlgorithm）在设置页一键切换；
- 删除/注册/运行等危险操作统一走 `Modal.confirm` 二次确认；API 错误由 axios 拦截器统一抛 AntD message/notification。

```bash
cd frontend
npm install --legacy-peer-deps
npm run typecheck    # tsc --noEmit（strict，noExplicitAny 是 error）
npm run lint         # eslint --max-warnings=0
npm run build        # typecheck + vite build（vendor 分包）
```

生产部署时用 Nginx/Caddy 反代到 uvicorn（不要让前端容器直连后端容器名）；反代需关闭 SSE 缓冲（后端已发 `X-Accel-Buffering: no`）。

## 测试

本仓库没有 CI/CD 与 pre-commit，提交前请手动运行（或一键 `scripts/check.sh`）：

```bash
export MINI_PIPELINE_CONFIG=config/default.yaml

.venv/bin/pytest -q          # Windows: .venv/Scripts/python -m pytest -q
.venv/bin/ruff check .

cd frontend && npm run typecheck && npm run lint && npm run build
```

测试覆盖：配置/数据库、manifest（v1→v2 升级、entry 校验）、ZIP 路径穿越、DAG 环检测、表达式解析、Runtime 超时/取消/重试、v1/v2 协议执行、fan-out/fan-in、branch run、鉴权角色、分页、限流、SSE 流、ETag 304、孤儿收割、GC，以及本地 Git 端到端。

## 项目结构

```text
ci/
├── mini_pipeline/           # FastAPI 后端
│   ├── account/             # 账户与权限核心（密码哈希、Session、Grants、Teams、机器凭证加密）
│   ├── api/                 # 路由、鉴权、分页信封（流水线/机器/团队/插件）
│   ├── artifact/            # LocalArtifactStore（ETag/304）
│   ├── core/                # 配置、Services 装配、EventBus/取消注册表、日志
│   ├── database/            # ORM 模型、仓储（分页/收割/团队/机器/审计）
│   ├── domain/              # v2 资源契约、状态机、异常、Runtime 协议
│   ├── executor/            # 任务执行、workspace 上下文、输出收集（含 v1 兼容）
│   ├── maintenance/         # mini-pipeline-gc
│   ├── pipeline/            # YAML schema、DAG、表达式、wiring 校验
│   ├── plugin/              # manifest（v1 自动升级）与注册服务
│   ├── runner/              # Pull 模式 Agent（长轮询、租约心跳、取消信号处理）
│   ├── runtime/             # ProcessRunner 底座 + shell/python/node/executable
│   ├── scheduler/           # 引擎（取消/重试/事件）、双线程池、恢复
│   ├── server/              # app 工厂、中间件、指标、单指令安装器（/install）
│   └── source/              # git/http/upload/toolhub 来源 + 安全解压
├── frontend/                # React 19 管理后台（Vite + AntD 5）
├── deploy/                  # 生产环境非源码交付套件（纯镜像 Compose + 一键部署脚本）
├── examples/                # 17 个示例插件 + 4 个示例 Pipeline
├── migrations/              # Alembic 迁移
├── config/                  # default.yaml（开发）/ docker.yaml（生产）
├── toolhub/                 # 独立的 shell 工具分发系统（后端对接其 index.json）
├── tests/                   # unit/ + integration/
├── docs/                    # 架构、运维、路线图、非源码部署指南
└── scripts/                 # start.sh、check.sh、package_release.py（发布打包脚本）
```

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | 分层架构、运行时底座、横切面设计 |
| [docs/operations.md](docs/operations.md) | 运维手册：探针/指标/日志/GC/恢复/排障 |
| [docs/deploy/非源码部署指南.md](docs/deploy/非源码部署指南.md) | **非源码生产发布、单机一键安装与多机分布式部署指南** |
| [docs/roadmap.md](docs/roadmap.md) | 演进计划：Docker Runtime → S3 产物库 → 内容寻址缓存 |
| [docs/design-multi-runner.md](docs/design-multi-runner.md) | 多用户/机器注册/远程执行设计 |
| [CHANGELOG.md](CHANGELOG.md) | 版本变更（含 BREAKING 与升级指南） |
| [docs/frontend.md](docs/frontend.md) | 前端分层规范 |
| [Pipeline Runtime Protocol v2（建议方案）.md](<Pipeline Runtime Protocol v2（建议方案）.md>) | v2 协议设计 |
| [docs/original-design.md](docs/original-design.md) | 最初需求稿 |
