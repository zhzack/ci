# Mini Pipeline

一个使用 FastAPI 实现的轻量级、模块化流水线执行平台。当前版本 `0.2.0` 在 MVP 之上补齐了平台化基线能力：

- 插件注册：Git / HTTP ZIP / 上传 ZIP / 文件夹上传 / toolhub 制品仓；版本化 `plugin.yaml`（v1 自动升级 v2 契约）；
- Pipeline YAML → DAG 并行调度，`${{ params.* }}` / `${{ steps.<dep>.outputs.* }}` / `${{ all.deps.outputs.* }}` 表达式接线；
- 插件 = 普通进程：Shell / Python / Node / Executable Runtime，超时、取消（进程树终止）、step 级重试与指数退避；
- **运行取消**、branch run（复用上游结果重跑下游）；
- **SSE 实时推送**：run 事件流 + 任务日志流（替代轮询）；
- **鉴权**：API token + admin/reader 角色；**限流**、CORS、GZip、RequestID 贯穿日志；
- **可观测**：`/health`（liveness）、`/health/ready`（readiness）、`/metrics`（Prometheus）、text/JSON 结构化日志；
- **API 工程化**：统一分页信封、OpenAPI tag 元数据、产物 sha256 ETag/304 缓存；
- **可靠性运维**：Alembic 迁移、启动孤儿收割、保留策略 GC（`mini-pipeline-gc`）；
- SQLite 本地运行、PostgreSQL Docker Compose 运行；React 19 管理后台（暗色主题、服务端分页、实时日志）。

详细设计见 [架构文档](docs/architecture.md)，运维手册见 [operations](docs/operations.md)，演进计划见 [roadmap](docs/roadmap.md)，变更历史见 [CHANGELOG](CHANGELOG.md)，最初需求稿保存在 [原始设计](docs/original-design.md)。

## 1. 快速开始

需要 Python 3.9+，Git 来源注册还需要系统已安装 `git`。

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -e '.[dev]'
export MINI_PIPELINE_CONFIG=config/default.yaml
uvicorn mini_pipeline.server.app:app --reload
```

服务地址：

- API：<http://127.0.0.1:8000/api>
- Swagger UI：<http://127.0.0.1:8000/docs>
- 健康检查：<http://127.0.0.1:8000/health>

默认数据写入 `./data`，使用 SQLite 数据库。

## 2. Docker Compose

```bash
docker compose up --build
curl http://127.0.0.1:8000/health
```

Compose 启动 API 与 PostgreSQL，并用 named volume 保存数据库和平台文件。MVP 只提供 Shell Runtime，不挂载宿主 Docker socket。

## 3. 插件规范

插件目录至少包含：

```text
hello/
├── plugin.yaml
└── run.sh
```

示例 [plugin.yaml](examples/plugins/hello/plugin.yaml)：

```yaml
name: hello
version: 1.0.0
description: Generate a greeting
runtime:
  type: shell
entry: run.sh
inputs:
  name:
    type: string
    required: true
outputs:
  greeting:
    type: string
```

平台在插件工作目录生成 `input.json`：

```json
{
  "task_id": "task-uuid",
  "workspace": "/absolute/workspace",
  "params": {"name": "world"},
  "dependencies": {}
}
```

插件必须生成 `output.json`：

```json
{
  "status": "success",
  "message": "done",
  "outputs": {"greeting": "Hello, world!"},
  "artifacts": [{"name": "greeting.txt", "path": "greeting.txt"}]
}
```

进程退出码必须为 0 且 `status` 必须为 `success`。产物必须是工作区内的普通文件。

> Shell 插件属于受信代码。MVP 有路径、归档、超时及工作区保护，但没有容器级强隔离；不要注册不可信代码。

## 4. 注册插件

### 4.1 上传 ZIP

先打包示例插件：

```bash
(cd examples/plugins/hello && zip -r /tmp/hello.zip .)
curl -X POST http://127.0.0.1:8000/api/plugins/upload \
  -F 'file=@/tmp/hello.zip;type=application/zip'
```

### 4.2 上传文件夹

后端 `POST /api/plugins/upload-folder` 接受 multipart 多个 `files` 字段，每个 part
的 `filename` 是相对路径（前端用 `<input webkitdirectory>` 自动获得）。后端会把所有
文件拼成一个 zip，再走与 ZIP 上传相同的安全解压路径。

```bash
curl -X POST http://127.0.0.1:8000/api/plugins/upload-folder \
  -F 'files=@examples/plugins/demo-greeter/plugin.yaml;filename=plugin.yaml' \
  -F 'files=@examples/plugins/demo-greeter/run.sh;filename=run.sh'
```

前端 Register 页面有独立的 **Upload folder** Tab：点击“Click to pick a plugin
folder”会弹出系统文件夹选择器，选中后表格列出所有文件及其相对路径，再点
“Upload folder and register”提交。

### 4.3 Git 来源

Git 仓库根目录必须是插件根目录：

```bash
curl -X POST http://127.0.0.1:8000/api/plugins/register \
  -H 'Content-Type: application/json' \
  -d '{
    "source": {
      "type": "git",
      "url": "https://example.com/team/hello-plugin.git",
      "branch": "main"
    }
  }'
```

可用 `branch`、`tag`、`revision` 或 `commit` 选择修订版本。生产环境应限制允许访问的 Git/HTTP 地址，避免把平台用作任意网络访问代理。

### 4.3 HTTP ZIP 来源

```bash
curl -X POST http://127.0.0.1:8000/api/plugins/register \
  -H 'Content-Type: application/json' \
  -d '{
    "source": {
      "type": "http",
      "url": "https://example.com/plugins/hello-1.0.0.zip"
    }
  }'
```

### 4.4 查询插件

```bash
curl http://127.0.0.1:8000/api/plugins
curl http://127.0.0.1:8000/api/plugins/hello/1.0.0
```

## 5. 定义与运行 Pipeline

示例 [demo.yaml](examples/pipelines/demo.yaml)：

```yaml
name: hello-demo
params:
  who: Mini Pipeline
steps:
  - name: greet
    plugin: hello@1.0.0
    with:
      name: "${{ params.who }}"
```

创建定义：

```bash
python - <<'PY' >/tmp/pipeline-request.json
import json
from pathlib import Path
print(json.dumps({"definition": Path("examples/pipelines/demo.yaml").read_text()}))
PY
curl -X POST http://127.0.0.1:8000/api/pipelines \
  -H 'Content-Type: application/json' \
  --data-binary @/tmp/pipeline-request.json
```

提交运行：

```bash
curl -X POST http://127.0.0.1:8000/api/runs \
  -H 'Content-Type: application/json' \
  -d '{"pipeline":"hello-demo","params":{"who":"Claude"}}'
```

响应状态是 `202`，其中的 `id` 是 run id。随后查询：

```bash
RUN_ID='<response-id>'
curl "http://127.0.0.1:8000/api/runs/$RUN_ID"
curl "http://127.0.0.1:8000/api/runs/$RUN_ID/tasks/greet/log"
```

运行响应内每个 artifact 带有不透明 `id`：

```bash
ARTIFACT_ID='<artifact-id>'
curl -OJ "http://127.0.0.1:8000/api/runs/$RUN_ID/artifacts/$ARTIFACT_ID"
```

## 6. DAG 与参数表达式

`depends` 可声明多个依赖。无依赖的步骤可并行执行；失败任务的传递下游为 `SKIPPED`，其他独立分支继续。支持四种显式表达式：

```yaml
with:
  input: "${{ params.input }}"
  result: "${{ steps.build.outputs.result }}"
  binary: "${{ steps.build.artifacts.app.path }}"
  messages: "${{ all.deps.outputs.message }}"   # 收集所有依赖的 outputs.<key> 为数组
```

整个值只有一个表达式时保留 JSON 类型；嵌在其他字符串中时转为文本。`all.deps.outputs.<key>` 适合“扇出 → 扇入”场景（例如三个并行 step 把结果汇总到一个汇总 step）。表达式不执行 Python 或 Shell 代码。

### 6.1 演示：可视化编辑 + fan-out/fan-in

后端已注册两个示例插件：

- `fanout-echo@1.0.0`（[examples/plugins/fanout-echo](examples/plugins/fanout-echo)）：接收 `message` 与 `tag`，回显一行文本并产出 `echo.txt` 产物；
- `fanout-aggregate@1.0.0`（[examples/plugins/fanout-aggregate](examples/plugins/fanout-aggregate)）：接收 `messages` 列表与 `title`，把多行汇总为 Markdown 摘要并产出 `summary.md`。

[examples/pipelines/fanout-demo.yaml](examples/pipelines/fanout-demo.yaml) 演示了 3 个并行 echo step + 1 个 aggregate step：

```yaml
name: fanout-demo
params:
  greeting: Mini Pipeline
steps:
  - {name: branch-a, plugin: fanout-echo@1.0.0, with: {message: "${{ params.greeting }} A", tag: alpha}}
  - {name: branch-b, plugin: fanout-echo@1.0.0, with: {message: "${{ params.greeting }} B", tag: beta}}
  - {name: branch-c, plugin: fanout-echo@1.0.0, with: {message: "${{ params.greeting }} C", tag: gamma}}
  - {name: aggregate, plugin: fanout-aggregate@1.0.0, depends: [branch-a, branch-b, branch-c],
     with: {title: "Fan-in summary", messages: "${{ all.deps.outputs.message }}"}}
```

前端 `Pipeline / Visual editor` 页（`/pipeline/visual`）打开后点 **Use fan-out demo**
即可一键填好这张表单；点 **Add step** 还能从已注册插件列表直接添加，每个 plugin 的 `inputs` 会自动渲染成对应类型的输入框（string/int/boolean 等），依赖用勾选方式选择，**Save pipeline** 之后即可到 `Task / History` 看到运行结果与下载 `summary.md` 产物。

## 7. REST API 摘要

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| POST | `/api/plugins/register` | 从 Git/HTTP 注册 |
| POST | `/api/plugins/upload` | 上传 ZIP 注册 |
| GET | `/api/plugins` | 插件版本列表 |
| GET | `/api/plugins/{name}/{version}` | 插件版本详情 |
| POST | `/api/pipelines` | 创建 Pipeline |
| GET | `/api/pipelines` | Pipeline 列表 |
| GET | `/api/pipelines/{id-or-name}` | 获取原始 YAML |
| PUT | `/api/pipelines/{id-or-name}` | 更新 Pipeline 定义 |
| GET | `/api/pipelines/{id-or-name}/params-schema` | 解析后输入/输出 schema（前端可视化编辑器 + Run 表单用） |
| GET | `/api/plugins/{name}/{version}/manifest` | 解析后的 manifest（用于前端可视化编辑器） |
| POST | `/api/runs` | 异步提交运行（202） |
| GET | `/api/runs` | 运行历史（分页，支持 `status` / `pipeline` 过滤） |
| GET | `/api/runs/{id}` | 查询运行及任务 |
| POST | `/api/runs/{id}/cancel` | 取消运行（终止插件进程树；终态 run 返回 409） |
| POST | `/api/runs/{id}/branches` | 从指定 step 分支重跑（复用上游输出） |
| GET | `/api/runs/{id}/tasks/{step}/log` | 获取任务日志 |
| GET | `/api/runs/{id}/tasks/{step}/log/stream` | 任务日志 SSE 流（tail 到任务结束） |
| GET | `/api/runs/{id}/events` | run/task 状态 SSE 事件流 |
| GET | `/api/runs/{id}/aggregated-log` | 全步骤聚合日志 |
| GET | `/api/runs/{id}/artifacts/{artifact}` | 下载产物（sha256 ETag，条件请求 304） |
| GET | `/api/artifacts` | 产物目录（分页） |
| GET | `/api/dashboard/summary` | Dashboard 统计（含最近 10 条 run 的摘要） |
| GET | `/health` / `/health/ready` / `/health/version` | 存活 / 就绪 / 版本探针 |
| GET | `/metrics` | Prometheus 指标（可关闭） |

所有列表接口返回统一分页信封：`{items, total, page, page_size, pages}`（`page_size` 上限 200）。

## 8. 配置

由 `MINI_PIPELINE_CONFIG` 指向 YAML 文件，默认是 `config/default.yaml`。主要配置：

- `database.url`：SQLAlchemy URL；
- `storage.*`：插件、工作区、日志、产物及临时目录；
- `execution.*`：`coordinator_workers`（DAG coordinator 数）、`task_workers`（任务执行线程数）、`task_timeout_seconds`（单任务超时）、`reap_orphans_on_start`（启动收割孤儿 run）、`retry_backoff_seconds`（重试退避基数）；
- `logging.{level,format}`：日志级别与输出格式（`text` / `json`）；
- `observability.metrics_enabled`：是否暴露 `/metrics`；
- `auth.{enabled,tokens}`：API 鉴权；token 条目形如 `{token, name, role: admin|reader}`；
- `security.{cors_origins,rate_limit_per_minute}`：CORS 白名单与写方法限流（0 关闭）；
- `retention.{workspaces_days,logs_days,artifacts_days,temp_hours}`：保留策略（GC 与 `mini-pipeline-gc` 使用）；
- `sources.*`：HTTP 超时和归档大小、文件数量限制。

YAML 内 `${ENV_NAME}` 会从环境变量严格展开；变量缺失时服务拒绝启动（`config/docker.yaml` 依赖 `.env` 注入，见 `.env.example`）。

## 9. 鉴权、取消、重试与实时日志

```bash
# 提交运行
RUN_ID=$(curl -s -X POST http://127.0.0.1:8000/api/runs   -H 'Content-Type: application/json'   -d '{"pipeline":"hello-demo","params":{}}' | python -c "import sys,json;print(json.load(sys.stdin)['id'])")

# 取消运行（终止运行中的插件进程，未开始的 step 置 CANCELLED）
curl -X POST "http://127.0.0.1:8000/api/runs/$RUN_ID/cancel"

# 实时状态流（SSE）
curl -N "http://127.0.0.1:8000/api/runs/$RUN_ID/events"

# 实时日志流（SSE，tail 到任务结束）
curl -N "http://127.0.0.1:8000/api/runs/$RUN_ID/tasks/greet/log/stream"
```

Step 级重试——在 pipeline YAML 中声明：

```yaml
steps:
  - name: flaky-step
    plugin: fetcher@1.0.0
    retries: 3          # 失败后按 2^n 秒指数退避自动重试，共执行 4 次
    with: {url: "https://example.com"}
```

启用鉴权后（`auth.enabled: true`），请求需携带 `Authorization: Bearer <token>` 或
`X-API-Key: <token>`：`reader` 角色只能 GET/HEAD，`admin` 可执行全部操作，
`/api/debug/**` 始终要求 admin。

## 10. 测试与检查

本仓库没有 CI/CD 与 pre-commit，提交前请手动运行（一键脚本 `scripts/check.sh`）：

```bash
MINI_PIPELINE_CONFIG=config/default.yaml .venv/bin/pytest -q   # Windows: .venv/Scripts/python -m pytest
ruff check .
cd frontend && npm run typecheck && npm run lint && npm run build
```

测试覆盖配置/数据库、Manifest、ZIP 路径穿越、DAG 环、表达式、Runtime 超时、成功执行、日志/产物和失败传播。完整端到端测试还会创建本地 Git 仓库，通过公开 API 注册并运行。

## 11. 项目结构

```text
ci/
├── docs/                    # architecture.md、frontend.md、original-design.md
├── examples/                # 示例插件和 Pipeline
├── frontend/                # React 19 + AntD 管理后台
├── mini_pipeline/           # FastAPI 后端
│   ├── api/                 # HTTP router 与依赖
│   ├── artifact/            # ArtifactStore 实现
│   ├── core/                # 配置与服务装配
│   ├── database/            # ORM、会话、仓储
│   ├── domain/              # 跨模块模型、协议、异常、状态
│   ├── executor/            # 插件 JSON 协议与任务执行
│   ├── pipeline/            # YAML schema、DAG、表达式
│   ├── plugin/              # Manifest 与注册服务
│   ├── runtime/             # Shell Runtime 与注册表
│   ├── scheduler/           # Coordinator、Dispatcher、RunService
│   ├── server/              # FastAPI 生命周期与入口
│   └── source/              # Git、HTTP、Upload provider
├── tests/                   # 后端 pytest 套件
├── config/                  # YAML 配置
└── scripts/
```

## 12. 前端管理后台

[`frontend/`](frontend) 是独立的 React 19 + Vite + Ant Design 5 工程，遵循
[《前端设计文档》](docs/frontend.md) 的分层规范：

- 业务代码按 `api/hooks/components/pages/store/types` 分类；页面只做编排；
- 远端数据全部交给 TanStack Query；本地只保留 user/menu/theme；
- 删除、注册、运行走 `Modal.confirm`/`Popconfirm` 二次确认；
- `LogViewer` 支持关键字高亮、复制、下载、自动滚动；`useLogStream` 预留 WebSocket 接入；
- `PipelineGraph` 是节点/边列表预览，未来 React Flow 渲染只替换实现。

```bash
cd frontend
npm install --legacy-peer-deps
npm run dev          # http://127.0.0.1:5173 ，/api 自动代理到 8000
npm run typecheck
npm run lint
npm run build        # 类型检查 + Vite 生产构建
```

Vite 默认把 `/api` 代理到 `http://127.0.0.1:8000`；可通过环境变量
`VITE_API_TARGET` 覆盖。Docker 部署场景下推荐用 Nginx/Caddy 反向代理到
`uvicorn mini_pipeline.server.app:app`，不要让前端容器直接连接后端容器名。

0.2 已落地鉴权、迁移、可观测性、取消/重试与 SSE 实时推送；下一阶段（Docker Runtime、S3 产物库、持久队列与分布式 Runner、React Flow DAG 等）的计划与验收口径见 [docs/roadmap.md](docs/roadmap.md)。运维操作（探针、GC、恢复、排障）见 [docs/operations.md](docs/operations.md)。
