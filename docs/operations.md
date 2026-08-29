# 运维手册（Operations Runbook）

面向部署与运维人员的实操指南。架构背景见 `docs/architecture.md`，配置项速查见 `readme.md` §8。

## 1. 进程与端口

| 组件 | 说明 |
| --- | --- |
| uvicorn / FastAPI | 单进程承载 API、调度器（线程池）、SSE 推送、Prometheus 指标 |
| PostgreSQL / SQLite | 状态存储（runs/tasks/artifacts/pipelines/plugins） |
| 插件进程 | 由 Shell/Python/Node Runtime fork 的子进程，受超时与取消管控 |

## 2. 健康检查与指标

| 端点 | 用途 |
| --- | --- |
| `GET /health` | 存活探针（liveness），不触碰任何依赖 |
| `GET /health/ready` | 就绪探针（readiness），校验 DB 连通、存储可写、dispatcher 是否在收单；异常返回 503 |
| `GET /health/version` | 版本信息（灰度发布核对用） |
| `GET /metrics` | Prometheus 文本格式（`observability.metrics_enabled` 可关闭） |

**Kubernetes 语义**：`/health` 用于 livenessProbe，`/health/ready` 用于 readinessProbe。docker-compose 已内置 API 容器健康检查。

**核心指标**：

| 指标 | 含义 |
| --- | --- |
| `mini_pipeline_http_requests_total` | 按 method × route 模板 × status 统计的请求量 |
| `mini_pipeline_http_request_duration_seconds` | 请求延迟直方图（按 route 模板聚合，label 无基数爆炸风险） |
| `mini_pipeline_runs_total{status}` | 终态 run 计数（SUCCESS/FAILED/CANCELLED） |
| `mini_pipeline_task_duration_seconds{plugin}` | 插件任务耗时直方图 |
| `mini_pipeline_task_retries_total{plugin}` | 自动重试次数 |

## 3. 日志

- `logging.format: text`（开发）或 `json`（生产，docker.yaml 默认）。
- JSON 行包含 `ts / level / logger / message / request_id`。
- 每个请求注入 16 位 `X-Request-ID`（可由网关传入），响应头原样回传；访问日志与异常日志共享同一 id，用于串联一次请求的所有日志。
- 任务日志（插件 stdout）按 `storage/logs/<run-id>/<task-id>.log` 落盘，实时可 tail；聚合视图 `GET /api/runs/{id}/aggregated-log`。

## 4. 实时推送（SSE）

- `GET /api/runs/{id}/events`：run/task 状态事件流，事件总线直接推送（毫秒级），附带周期性 DB 快照兜底；run 到达终态后服务端主动结束流。
- `GET /api/runs/{id}/tasks/{step}/log/stream`：日志文件 tail 流（SSE `log` 事件 + `end` 事件），替代 2 秒轮询。
- 经反代部署时注意关闭代理缓冲（nginx：`proxy_buffering off` 或后端已发送的 `X-Accel-Buffering: no`）。
- EventSource 断线由浏览器自动重连；服务端流结束（终态）后客户端不应重连。

## 5. 鉴权

- 开发默认 `auth.enabled: false` → 所有请求视为匿名 admin。
- 生产 `auth.enabled: true`：请求需携带 `Authorization: Bearer <token>` 或 `X-API-Key: <token>`。
- 角色：`reader` 只能 GET/HEAD；`admin` 可执行全部操作；`/api/debug/**` 始终要求 admin。
- 令牌在 YAML 中配置并支持 `${ENV}` 展开；**docker.yaml 三个变量（LOG_LEVEL、两个 token）缺失即拒绝启动**，这是有意为之的防爆设计。

## 6. 限流

- `security.rate_limit_per_minute`：对 POST/PUT/PATCH/DELETE 的每 IP 滑动窗口限流，超限返回 429 + `Retry-After`。
- GET 不限流（读多写少的平台语义）。多副本部署时请在前置网关做限流，本中间件只保护单进程。

## 7. 取消与重试

- **取消**：`POST /api/runs/{id}/cancel`。运行中的插件进程被整树终止（POSIX `killpg`，Windows `taskkill /T`），未开始的 step 标记 `CANCELLED`，run 终态为 `CANCELLED`。对终态 run 取消返回 409。
- **重试**：step 级声明 `retries: n`（pipeline YAML），失败后按 `retry_backoff_seconds × 2^(attempt-1)` 指数退避自动重跑；最终尝试的 `attempt` 字段持久化在 task 上（API `TaskResponse.attempt`）。

## 8. 崩溃恢复

- 服务启动时执行 **孤儿收割**（`execution.reap_orphans_on_start: true`）：把仍处于 PENDING/RUNNING 的 run 标记为 FAILED（message 说明服务重启中断），对应 task 同步置 FAILED。进程内线程池不持久化队列，因此这是崩溃后唯一一致的状态修复方式；需要"断点续跑"语义时使用 **branch run**（`POST /api/runs/{id}/branches`）复用上游成功结果。

## 9. 数据保留与 GC

- 配置 `retention.{workspaces_days, logs_days, artifacts_days, temp_hours}`（0 = 永久保留）。
- 手动/定时执行：`mini-pipeline-gc [--dry-run] [--verbose]`。
  - 删除终态 run 的 workspace、日志、产物目录（按各自窗口）；
  - 同步删除对应 `artifacts` 表记录，保证目录页不出现死链接；
  - 清理 `storage/tmp` 中超过 `temp_hours` 的残留文件。
- 建议 cron/计划任务每日执行一次（生产 compose 可加一个 cron 容器跑同一命令）。

## 10. 数据库迁移

- 开发 SQLite：启动时 `create_all` 自动建表，零配置。
- 生产/升级路径：`alembic upgrade head`（容器 entrypoint 已自动执行）。迁移脚本与配置同源（读取 `MINI_PIPELINE_CONFIG` 解析 DB URL）。
- **禁止**直接改表；新增字段请生成迁移：`alembic revision --autogenerate -m "..."`。

## 11. 性能与延迟设计速查

| 机制 | 收益 |
| --- | --- |
| SSE 事件推送替代轮询 | run/日志更新延迟从 2s 级降到毫秒级，且连接空闲期零请求 |
| 产物 ETag（sha256）+ `Cache-Control` | 重复下载命中 304，不传 body；大产物收益显著 |
| GZip（>1KB 响应） | JSON 列表/日志接口传输量下降 70–90% |
| 服务端分页（默认 50，上限 200） | 列表端点不随历史增长变慢；每条查询均走 LIMIT/OFFSET |
| route 模板级指标 label | 监控基数恒定，不会随 run 数量膨胀 |
| SQLite `PRAGMA foreign_keys` + `pool_pre_ping` | 引用完整性 + 连接失效自愈 |

## 12. 常见排查

| 现象 | 排查顺序 |
| --- | --- |
| 启动即退出 | 看 `ConfigurationError`：YAML `${VAR}` 未设置是主因（docker.yaml 三变量） |
| run 卡在 RUNNING | 崩溃遗留 → 重启后会被收割为 FAILED；运行中卡住 → 查 `task_workers` 是否被长任务占满（双线程池：coordinator_workers 推 DAG，task_workers 执行） |
| 取消后 run 仍 RUNNING | coordinator 等待进程树终止的宽限期；>10s 未终态收集 `X-Request-ID` + `mini_pipeline_task_duration_seconds` 查哪个插件挂住 |
| 429 大量出现 | `rate_limit_per_minute` 或客户端重试风暴；429 带 `Retry-After` |
| SSE 收不到事件 | 反代缓冲未关；或连接建立早于事件但错过了 snapshot（客户端会由快照兜底） |
