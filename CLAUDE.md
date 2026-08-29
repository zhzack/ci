# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目一句话

`Mini Pipeline` 是一个 FastAPI + React 的轻量级流水线执行平台。当前实现的是 **Pipeline Runtime Protocol v2**（见 `Pipeline Runtime Protocol v2（建议方案）.md`）：插件只是普通进程（无 SDK），平台负责资源解析、运行时分发、产物收集；流水线用 YAML 描述 DAG，输出通过 `${{ params.* }}` / `${{ steps.<dep>.outputs.* }}` / `${{ all.deps.outputs.* }}` 三种表达式接线。0.2 起平台具备 token 鉴权（admin/reader）、运行取消、step 重试、SSE 实时推送、Prometheus 指标、Alembic 迁移与保留策略 GC（详见 CHANGELOG.md 与 docs/operations.md）。

## 关键目录

- `mini_pipeline/` — 后端 (Python 3.9+, FastAPI, SQLAlchemy 2, Pydantic v2)
  - `core/` — Settings 加载（含 `${ENV}` 严格展开）、`Services` 装配容器、`events.py`（EventBus + CancellationRegistry）、`logging.py`（text/JSON 结构化日志）
  - `domain/` — 跨模块契约：`contract.py`（v2 Resource：InputResource/OutputResource/PluginContract；ResourceType=string/number/boolean/json/file/directory/list；ResourceSource=parameter/upload/url/artifact/generated）、`states.py`、`exceptions.py`
  - `database/` — SQLAlchemy 模型 + 仓储（`PipelineRepository`/`PluginRepository`/`RunRepository`），统一通过 `repositories.py`
  - `source/` — 插件来源注册表：`git.py`、`http.py`、`upload.py`、`registry.py`、`archive.py`（ZIP 安全解压：路径穿越/符号链接/大小/文件数限制）
  - `plugin/manifest.py` — `PluginManifest`（已统一为 v2 schema，v1 flat inputs/outputs 通过 `_upgrade_v1_to_v2` 自动升级；`runtime.entry` 解析为 `manifest.entry`，默认 `run.sh`）
  - `runtime/` — `base.ProcessRunner`（进程生命周期：日志泵、超时、取消、POSIX killpg / Windows taskkill 树终止）；`shell`/`python`/`node`/`executable` 四种 Runtime 是它的薄封装（Windows 下解析 shebang 走 Git Bash）；`runtime: docker` 已在 manifest 校验器中接受但未实现
  - `pipeline/` — `schema.py`（PipelineDefinition/PipelineStep，ref=`name@semver`）、`dag.py`（拓扑序）、`resolver.py`（表达式解析）、`service.py`
  - `executor/` — v2 协议全生命周期：`task_executor.py` 主流程，`context.py` 创建 `workspace/{input,output,temp,cache,logs}` + 写入 `context.json`，`collector.py` 收集 outputs/metadata/artifacts 并校验 `error.json`
  - `scheduler/` — `engine.PipelineEngine`（DAG coordinator + 取消/重试/事件发布）；`dispatcher.Dispatcher`（双线程池）；`service.RunService`（submit/cancel/branch）；`recovery.py`（启动孤儿收割）
  - `artifact/local.py` — `LocalArtifactStore`（本地持久化，下载用不透明 `artifact_id`，API 不暴露路径；下载响应带 sha256 ETag/304）
  - `api/router.py` 组装：根级 `observability.py`（`/health`、`/health/ready`、`/health/version`、`/metrics`）+ `/api/{plugins,pipelines,runs,artifacts,dashboard,debug}`；整个 `/api` 挂 `api/auth.py::require_auth`（启用鉴权时校验 token/角色，debug 仅 admin）；列表接口统一返回 `api/pagination.py` 的分页信封 `{items,total,page,page_size,pages}`；错误统一映射
- `frontend/` — React 19 + Vite 5 + TS strict + AntD 5 + TanStack Query 5 + Zustand；目录严格按 `api/hooks/components/pages/store/types` 分层（详见 `docs/frontend.md` 和 `简化流水线平台前端开发设计文档.md`）
- `examples/` — 示例插件（每个含 `plugin.yaml` + `run.sh`）和 Pipeline YAML（如 `v2-full-demo.yaml`、`fanout-demo.yaml`）
- `config/{default,docker}.yaml` — 主配置；`docker.yaml` 用 `${DATABASE_URL}` 占位由 docker-compose 注入
- `tests/` — `unit/` + `integration/`；`tests/conftest.py` 提供 `settings`/`client`/`plugin_zip` 三个共享 fixture

## 常用命令

### 后端

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -e '.[dev]'             # 装 ruff/pytest
export MINI_PIPELINE_CONFIG=config/default.yaml
uvicorn mini_pipeline.server.app:app --reload   # http://127.0.0.1:8000 ，Swagger: /docs

# 测试
.venv/bin/pytest -q                                # 全部
.venv/bin/pytest tests/integration/test_v2_full_demo.py -q   # 单个集成用例
.venv/bin/ruff check .

# Docker
docker compose up --build
curl http://127.0.0.1:8000/health
```

### 前端

```bash
cd frontend
npm install --legacy-peer-deps
npm run dev          # 5173，/api 代理到 http://127.0.0.1:8000（VITE_API_TARGET 覆盖）
npm run typecheck    # tsc -p tsconfig.app.json --noEmit
npm run lint         # ESLint --max-warnings=0
npm run build        # typecheck + vite build
```

## 配置 & 路径约定

`MINI_PIPELINE_CONFIG` 指向 YAML，默认 `config/default.yaml`。关键键：

- `execution.{coordinator_workers,task_workers,task_timeout_seconds}`
- `sources.{http_timeout_seconds, max_archive_bytes, max_extracted_bytes, max_archive_files}`
- `storage.root` 下分 `plugins/`、`workspaces/<run-id>/<task-id>/`、`logs/<run-id>/<task-id>.log`、`artifacts/<run-id>/<task-id>/<artifact-id>/`、`tmp/`

`database.url` 同时支持 SQLite (`sqlite:///./data/mini_pipeline.db`) 与 Postgres (`postgresql+psycopg://...`)；YAML 中的 `${VAR}` 缺失会让启动直接拒绝。

## 插件协议要点

`plugin.yaml` v2：

```yaml
name: foo
version: 1.0.0
runtime:
  type: shell            # 也支持 python / node / executable / docker
  entry: run.sh          # 默认 run.sh
contract:
  inputs:
    - {name: count, type: number, source: parameter, required: true, default: 10}
    - {name: config, type: file, source: url, target: input/config.json}
    - {name: image, type: file, source: upload, target: input/image.jpg}
  outputs:
    - {name: report, type: file, path: output/report.json}
```

- 入口（`entry`）必须解析到插件根目录之内，文件存在，否则 `load_manifest` 抛 `ValidationError`
- 工作目录布局固定为 `workspace/{input,output,temp,cache,logs}` + `context.json`；环境变量注入：`PIPELINE_CONTEXT`、`PIPELINE_WORKSPACE`、`PIPELINE_TASK_ID`、`MINI_PIPELINE_WORKSPACE`
- 进程退出码 ≠ 0 或 `output.json` 中 `status != success` 都算失败；`error.json` 提供 `{code,message,suggestion}` 时优先取它作为失败 message
- 产物路径必须落在线程 workspace 内（防穿越）
- Shell Runtime 没有强隔离（详见 `docs/architecture.md` §10）；生产环境需 Docker/K8s Runtime

## Pipeline 引擎

- 提交时 `PipelineEngine.submit` 立即返回 `run_id`（HTTP 202），实际执行交给 `Dispatcher` 的双线程池
- 拓扑序在 `pipeline/dag.py`；`engine._advance_ready` 推进：上游任一 `FAILED/SKIPPED` → 下游标记 `SKIPPED`；全部 `SUCCESS` 才 `READY` → `RUNNING`
- 表达式解析在 `pipeline/resolver.py`：仅允许访问 `params.<k>` / `steps.<dep>.outputs.<k>` / `all.deps.outputs.<k>`，整值是 `${{ }}` 保留 JSON 原类型，嵌入字符串则变文本
- 前端 Form 模式提交 `{step_name: {key:value}, ...}` 会在 `engine._advance_ready` 合并进每个 step 的 `params`（详见 `engine.py` `step_override` 段）
- 启动前 `engine._preflight_required` 会校验：`required` 输入只能由 `params` 或上游 `steps.*.outputs.*` 满足，否则立即 `ValidationError`

## 状态机

```
Task:    PENDING -> READY -> RUNNING -> SUCCESS
                            |-> FAILED (重试耗尽后)
                            |-> SKIPPED (依赖失败/被跳过)
                            +-> CANCELLED (运行取消或依赖被取消)
Pipeline: PENDING -> RUNNING -> SUCCESS | FAILED | CANCELLED
```

## REST API 摘要

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查 |
| POST | `/api/plugins/register` | Git/HTTP 注册 |
| POST | `/api/plugins/upload` | ZIP 上传 |
| POST | `/api/plugins/upload-folder` | 多 part 文件夹上传（`files` 数组，`filename` 是相对路径） |
| GET | `/api/plugins` / `/api/plugins/{name}/{version}` | 列表/详情 |
| POST | `/api/pipelines` | 创建 Pipeline（body 是 `{definition: "<yaml>"}`） |
| GET | `/api/pipelines` / `/{id-or-name}` / `/{id-or-name}/params-schema` | 列表 / YAML / 前后端 schema |
| PUT | `/api/pipelines/{id-or-name}` | 更新 |
| POST | `/api/runs` | 异步运行，返回 `{id}` |
| GET | `/api/runs/{id}` / `/tasks/{step}/log` / `/artifacts/{artifact}` | run 详情 / 日志 / 产物下载 |
| GET | `/api/artifacts` / `/api/dashboard/summary` | 产物目录 / Dashboard |
| GET | `/api/plugins/{name}/{version}/manifest` | 解析后 manifest（前端可视化用） |
| GET | `/api/debug/...` | 调试端点（见 `routers/debug.py`） |

## 前端约定

- 服务端数据全部进 TanStack Query；本地只留 `user/menu/theme`（zustand + persist）
- API 错误统一由 `src/api/http.ts` 拦截器 + `bindAntdApis` 派发 `message` / `notification`
- 危险动作（删除、注册、运行）走 `Modal.confirm` / `Popconfirm`
- 日志查看器 `LogViewer` 支持关键字高亮/复制/下载/自动滚动；已预留 `useLogStream` hook 用于未来 WebSocket 接入
- `PipelineGraph` 当前是节点/边列表预览；`summarizeGraph` 契约稳定，未来替换 React Flow 只换实现
- TypeScript `strict`；`any` 在 ESLint 报错；`@/*` alias → `src/*`

## Phase 1 之后（0.2 已完成）

0.2 补齐了：鉴权、Alembic、结构化日志/Prometheus/就绪探针、分页/限流/CORS/GZip/OpenAPI、取消、重试、SSE（run 事件流 + 日志流）、产物 ETag、启动孤儿收割、保留策略 GC、前端暗色主题/服务端分页/SSE 日志。下一阶段计划（Docker Runtime、S3 ArtifactStore、持久队列/分布式 Runner、React Flow DAG 等）见 `docs/roadmap.md`；已完成项明细见 `CHANGELOG.md`。

## 文档入口

- 平台 README：`readme.md`
- 架构：`docs/architecture.md`
- 运维手册（探针/指标/GC/恢复/排障）：`docs/operations.md`
- 演进路线：`docs/roadmap.md`
- 变更历史：`CHANGELOG.md`
- 前端规范：`docs/frontend.md` + `简化流水线平台前端开发设计文档.md`
- v2 协议提案：`Pipeline Runtime Protocol v2（建议方案）.md`
- 原始需求稿：`docs/original-design.md`
