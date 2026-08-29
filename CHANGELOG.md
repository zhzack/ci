# Changelog

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
