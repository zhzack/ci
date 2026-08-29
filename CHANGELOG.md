# Changelog

## 0.3.0 — 多用户、机器注册与远程执行（2026-08-29)

> 设计与决策记录见 `docs/design-multi-runner.md`。

### 新增

- **用户体系**：注册/登录（scrypt 密码哈希）、DB 会话令牌（`mpt_`，只存 sha256）、首个注册用户自动成为平台 admin；`auth.registration_enabled` 开关；静态配置 token 保持兼容（reader 只读语义不变）。
- **机器注册**：`machines` 表 + `/api/machines` CRUD。
  - **admin 机**：管理员创建，可存机密凭证（Fernet 加密，`security.secret_key`），分配给用户；被分配者可跑任务、永远看不到凭证；
  - **personal 机**：自助注册，runner token 一次性展示，支持转移归属、共享（user×operator 授权）、令牌轮换、吊销；
  - 心跳/在线状态（`offline_after_seconds`）。
- **远程执行**：run 提交支持 `machine` 目标（run 级 + step 级 `machine:` 字段）；任务 QUEUED → runner 原子认领 → 下载任务包（插件+已解析 workspace）→ 本地执行 → 日志/产物/终态回传；**LeaseReaper** 把失去心跳的任务标记 FAILED；取消经心跳指令下发到 agent 终止进程树。
- **Runner agent**：`mini-pipeline-runner --server … --token mrt_…`，只需出站 HTTPS；复用平台的 Runtime/collector/manifest 栈。
- **插件商店**：`visibility`/`review_status` + 发布申请/管理员审批 API；商店目录 `/api/plugins/store`；插件详情页发布按钮 + 审批操作。
- **授权系统**：`share_grants`（user/team × viewer/operator）+ `/api/grants` API；团队/成员管理（admin API）；所有列表端点按「owner ∪ 授权 ∪ 平台资源 ∪ 公开」过滤；隐藏资源统一返回 404（防枚举）。
- **单指令自适应部署（`/install`）**：支持类似 OpenClaw 的一键快速部署。服务端解析客户端 `User-Agent`，自动分发适配 Windows PowerShell（兼容 5.1/7+，修复 `||` 语法）或 Linux/macOS Shell 的安装脚本；支持 `?token=mrt_...` 动态注入，脚本解压安装后静默自启动 Runner Agent；前端机器弹窗提供多平台一键复制 Tabs 与管理员特权运行指导。
- **SSH 模式直连执行**：机器注册新增 `connection_type`（`agent` / `ssh`）切换；支持配置 Host/IP、Port、Username、密码或私钥并进行 Fernet 对称加密静态落库；服务端基于 Paramiko SFTP/SSH 实现免 Agent 的打包直推执行与产物回传；新增连通性测试接口（`/api/machines/{id}/test-connection`）并在前端列表及详情中提供实时时延探测。
- **默认鉴权拦截与路由守卫**：`config/default.yaml` 默认启用 `auth.enabled: true` 并配置开发默认加密密钥；前端全局守卫 `AuthGate` 实时阻断未登录用户访问 Dashboard 及内部所有页面并重定向至 `/login`；后端核心 API 严格校验 Bearer Token（未认证 401）。
- **Windows 执行环境全面加固**：
  - `ProcessRunner` 运行时主动将当前 Python 虚拟环境目录前置至 `PATH`，并在环境中补全 `python3.exe`，彻底绝缘 Windows 应用商店 Python 伪存根干扰（退出码 9009 / Bash 49）；
  - `mini_pipeline.runtime.shell` 优先探测并调用 Git Bash，屏蔽 System32 下未初始化的 WSL 空壳存根（退出码 127）；
  - 修复示例插件 `run.sh` 中 Quoted Heredoc 导致工作区变量未展开、触发 Windows 路径冒号非法字符（`WinError 123`）的缺陷；
  - 修复 `LogTee` 日志流在瞬态任务退出时的清空刷新（flush drain）断流缺陷，避免日志丢失。
- **审计日志**：`audit_logs` 表记录全部 mutating 操作（actor/action/resource/request_id），admin 控制台可查。
- **前端**：登录/注册页（渐变视觉）、路由守卫（`AuthGate`）、机器管理页（注册向导 + 令牌一次性弹窗 + SSH 模式表单与连通性测试 + 共享/转移抽屉）、管理控制台（用户/审计）、插件商店页、运行对话框机器选择器、插件详情发布按钮、用户菜单（登出）、主题重做（新主色/侧栏渐变/卡片阴影）。

### 变更（BREAKING）

- 新增 Alembic 迁移 `1eaa4dad943f`（users/machines/grants/audit + 存量表加列；SQLite 走 batch 模式）。升级前执行 `alembic upgrade head`。
- 启用鉴权后，未认证请求 401；`/api/debug`、`/api/admin` 仅 admin。
- docker.yaml 新增必需变量 `MINI_PIPELINE_SECRET_KEY`（加密机器凭证）。
- 存量资源 owner 为 NULL，视为平台资源（全员可见）——升级不丢可见性。

## 0.2.0 — 平台化基线（2026-08-29)

> 主题：补齐商业项目标配——安全、可观测、可靠性、实时性与 API 工程化。

### 新增（后端）

- **鉴权与角色**：token 认证（`Authorization: Bearer` / `X-API-Key`），admin/reader 两级角色；`/api/debug/**` 仅 admin；`auth.enabled: false` 时保持匿名直通（开发默认）。
- **运行取消**：`POST /api/runs/{id}/cancel`；新增 `CANCELLED` run/task 状态；运行中插件进程整树终止（POSIX `killpg` / Windows `taskkill /T`）；终态 run 取消返回 409。
- **Step 级自动重试**：pipeline YAML step 新增 `retries: n`；指数退避（`execution.retry_backoff_seconds`，上限 60s）；task 持久化 `attempt` 字段并经 API 暴露。
- **SSE 实时推送**：`GET /api/runs/{id}/events`（run/task 状态事件 + 快照兜底）、`GET /api/runs/{id}/tasks/{step}/log/stream`（日志 tail 流），run/日志更新从 2s 轮询降到毫秒级。
- **可观测性**：`/health`（含版本与 uptime）、`/health/ready`（DB/存储/dispatcher 就绪校验，失败 503）、`/health/version`、`/metrics`（Prometheus：HTTP 请求量/延迟直方图、run 终态计数、任务耗时/重试）。
- **结构化日志**：`logging.format: text|json`；每请求 16 位 `X-Request-ID`（可由网关注入，响应回传）贯穿访问日志与错误响应。
- **限流**：`security.rate_limit_per_minute` 对写方法按客户端 IP 滑动窗口限流（429 + Retry-After），GET 不限。
- **CORS**：`security.cors_origins` 配置化。
- **分页信封**：`{items,total,page,page_size,pages}`；`GET /api/plugins`、`GET /api/pipelines`、`GET /api/artifacts` 迁移为信封并新增 `GET /api/runs`（status/pipeline 过滤）；page_size 上限 200。
- **产物缓存**：下载端点携带 sha256 ETag 与 `Cache-Control: immutable`，条件请求返回 304。
- **崩溃恢复**：启动时孤儿收割——将遗留 PENDING/RUNNING 的 run 标记 FAILED（`execution.reap_orphans_on_start`）。
- **保留策略 GC**：`mini-pipeline-gc [--dry-run]` 按 `retention.*` 清理 workspace/日志/产物（含 DB 记录）/tmp 残留。
- **Alembic 迁移**：初始迁移生成全 schema；`migrations/env.py` 与应用同源读 `MINI_PIPELINE_CONFIG`；容器 entrypoint 自动 `alembic upgrade head`；移除 SQLite "drop+recreate" 伪迁移。

### 变更（后端）

- Shell Runtime 在 Windows 上解析 shebang 并分发到 Git Bash/解释器，插件脚本跨平台可执行。
- v1 插件协议兼容层恢复：执行器写 `input.json`（含运行级参数合并），读 `output.json`（status 校验 + outputs/artifacts 合并）。
- v2 JSON 输出对象按「资源名 + 顶层键合并」双地址写入 outputs（`${{ steps.x.outputs.<key> }}` 直达）。
- 4 个 Runtime 重构为共享 `ProcessRunner`（统一超时/取消/进程树终止/日志泵）。
- debug 路由改用 ORM 仓储（原来原生 sqlite3 直连，Postgres 下直接 400）。
- wiring 校验（`POST /api/pipelines/validate`）适配 v2 list 契约，且通过插件仓储定位 install path（原来重读全局配置猜路径）。
- manifest 端点响应附带顶层 `inputs`/`outputs` 兼容别名。
- middleware 栈：GZip（>1KB）→ 限流 → 指标 → RequestID；OpenAPI 增加 tag 元数据。

### 移除

- 未接线的平行实现：`executor/task_executor_v2.py`、`plugin/manifest_v2.py`、`executor/protocol.py`（`DependencyResult` 迁至 `executor/dependencies.py`）、`scheduler/nodes.py`、`run_nodes` 表与 `task_runs.node_id`（初始迁移即为最终形态）。

### 前端

- 新增 `useRunEventStream`（SSE run 状态流）与 `useLogStream`（SSE 日志 tail，保留轮询回退）；运行详情页实时更新，状态栏显示 live 标记。
- 运行页新增「取消」按钮（二次确认）；任务表新增 Attempt 列；CANCELLED 状态色。
- 列表页（plugins/pipelines/artifacts/runs）迁移为服务端分页 + 状态/管线过滤。
- 暗色主题真正生效（AntD `darkAlgorithm` + body 背景切换）；设置页新增版本与就绪状态卡。
- 构建按 react/antd/query 分包。

### BREAKING（对照 0.1）

- 列表接口返回分页信封（不再是裸数组）。
- `GET /health` 响应新增 `version`/`uptime_seconds` 字段。
- debug 路由要求 admin（启用鉴权时）。
- 移除 `run_nodes` 表（从未被写入）。

### 升级指南

1. `pip install -e '.[dev]'`（新增 prometheus-client、alembic）。
2. 生产库执行 `alembic upgrade head`（容器已自动）。
3. 依 `.env.example` 补齐 `LOG_LEVEL` / `MINI_PIPELINE_ADMIN_TOKEN` / `MINI_PIPELINE_READER_TOKEN`。

## 0.1.0 — Phase 1 MVP

- Pipeline Runtime Protocol v1/v2、插件注册（git/http/upload/toolhub）、DAG 调度、Shell/Python/Node/Executable Runtime、本地产物存储、SQLite/PostgreSQL、React 管理后台。
