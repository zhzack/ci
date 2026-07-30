# Mini Pipeline 架构

## 1. 目标与边界

Mini Pipeline 是一个轻量级流水线执行平台。MVP 提供：

- 从 Git、HTTP ZIP 或上传 ZIP 注册版本化插件；
- 用 YAML 定义 Pipeline，并校验任务依赖图；
- 在本机 Shell Runtime 中按 DAG 执行插件；
- 统一传递 JSON 输入/输出，收集日志和产物；
- 通过 REST API 注册、运行、查询及下载结果。

MVP 不包含账号权限、Web UI、Docker Runtime、远程对象存储、分布式队列、重试与缓存。这些能力通过接口边界预留，不进入首版执行路径。

## 2. 分层与组件

```text
HTTP Client
    |
FastAPI routers
    |
Application services -----------------------------------+
    |                                                   |
    +-- PluginService --> SourceRegistry --> Git/HTTP/Upload
    |         |                                         |
    |         +--> PluginRepository --> SQLAlchemy      |
    |                                                   |
    +-- PipelineService --> Parser --> DAG              |
    |         |                                         |
    |         +--> PipelineRepository --> SQLAlchemy    |
    |                                                   |
    +-- Scheduler --> TaskExecutor --> RuntimeRegistry -+--> Shell process
              |             |
              |             +--> ArtifactStore ------------> Local files
              |
              +--> Run/Task repositories -----------------> SQLAlchemy
```

依赖方向固定为 `server/api -> 应用服务 -> 领域契约 -> 基础设施实现`。Router 只处理 HTTP 数据转换，不直接操作 ORM、文件或子进程。

## 3. 核心模块

| 模块 | 职责 |
| --- | --- |
| `core` | YAML 配置、环境变量展开、依赖装配 |
| `domain` | 状态枚举、跨模块 DTO、领域异常、协议接口 |
| `database` | SQLAlchemy 模型、会话与仓储 |
| `source` | 将不同来源获取到临时插件目录 |
| `plugin` | Manifest 校验、版本注册与插件目录管理 |
| `pipeline` | Pipeline YAML schema、DAG、参数/上游结果解析 |
| `runtime` | 执行插件入口；MVP 仅 Shell |
| `executor` | 工作区、input/output 协议、日志及产物收集 |
| `scheduler` | Pipeline run 生命周期与 DAG 并行调度 |
| `artifact` | 产物持久化；MVP 为本地受管目录 |
| `api/server` | REST API、错误映射、应用生命周期 |

## 4. 关键数据流

### 4.1 注册插件

1. API 接收来源配置或 ZIP 文件。
2. `PluginService` 选择 `PluginSource`，获取到随机临时目录。
3. 安全解压逻辑阻止路径穿越、符号链接和超限归档。
4. 解析 `plugin.yaml`，校验名称、版本、入口及运行时。
5. 将目录原子移动到 `plugins/<name>/<version>`，再保存数据库记录。
6. 任一步失败都会清理临时目录；数据库失败时也回滚安装目录。

### 4.2 创建及运行 Pipeline

1. API 保存 YAML 前先经 Pydantic schema 和 DAG 环检测。
2. 提交运行时创建 `PipelineRun` 和每个 `TaskRun`，立即返回 run id。
3. Coordinator 独占线程池推进 DAG，Task Worker 线程池执行就绪节点。
4. Executor 解析 `with` 参数，生成 `input.json`，运行插件并实时写日志。
5. 插件写出 `output.json`；Executor 校验后收集位于 workspace 内的产物。
6. Scheduler 更新任务状态并解锁下游，最后聚合 Pipeline 状态。

Coordinator 与 Task Worker 使用两个线程池，避免多个长生命周期协调器占满任务执行资源。

## 5. 插件协议

插件目录：

```text
plugin/
├── plugin.yaml
├── run.sh
├── src/
└── README.md
```

执行时工作区包含插件文件和平台生成的 `input.json`。插件在当前工作区执行，并创建 `output.json`。

输入：

```json
{
  "task_id": "uuid",
  "workspace": "/absolute/workspace",
  "params": {"name": "world"},
  "dependencies": {
    "previous": {"outputs": {}, "artifacts": []}
  }
}
```

输出：

```json
{
  "status": "success",
  "message": "done",
  "outputs": {"greeting": "hello world"},
  "artifacts": [{"name": "result.txt", "path": "result.txt"}]
}
```

仅 `status: success` 且进程退出码为 0 才算成功。产物路径必须解析到任务 workspace 内。

## 6. Pipeline 数据与表达式

```yaml
name: demo
params:
  who: world
steps:
  - name: greet
    plugin: hello@1.0.0
    with:
      name: "${{ params.who }}"
  - name: consume
    plugin: consumer@1.0.0
    depends: [greet]
    with:
      greeting: "${{ steps.greet.outputs.greeting }}"
```

支持：

- `${{ params.<key> }}`
- `${{ steps.<step>.outputs.<key> }}`
- `${{ steps.<step>.artifacts.<name>.path }}`

完整字符串只有一个表达式时保留 JSON 原类型；表达式嵌入其他文本时转换为字符串。解析只允许显式字段访问，不执行任意代码。

## 7. 状态机

```text
Task:     PENDING -> READY -> RUNNING -> SUCCESS
                              |          FAILED
                              +--------> FAILED
             +-------------------------> SKIPPED (依赖失败)

Pipeline: PENDING -> RUNNING -> SUCCESS | FAILED
```

失败节点只阻断其传递下游；互不依赖的分支仍继续。只要存在 `FAILED` 或 `SKIPPED` 任务，Pipeline 最终为 `FAILED`。

## 8. 数据与文件布局

```text
data/
├── mini_pipeline.db
├── plugins/<name>/<version>/
├── workspaces/<run-id>/<task-id>/
├── logs/<run-id>/<task-id>.log
├── artifacts/<run-id>/<task-id>/<artifact-id>/
└── tmp/
```

数据库保存元数据和状态，二进制内容不进入数据库。日志可在任务运行中读取；产物使用不透明 id 下载，API 不接受任意文件路径。

## 9. 扩展点

- 新来源：实现 `PluginSource.fetch()` 并注册到 `SourceRegistry`。
- 新 Runtime：实现 `Runtime.execute()` 并注册 runtime type。
- 新产物后端：实现 `ArtifactStore.store/open()`，可替换为 MinIO/S3。
- 分布式执行：将 Scheduler 的 Dispatcher 替换为持久队列，不改变 Pipeline 或 Plugin 协议。
- 数据迁移：MVP 启动时建表；进入生产演进阶段后接入 Alembic。

## 10. 安全与运行约束

Shell 插件本质上是受信代码，MVP 不提供强隔离，只应注册和运行可信来源。平台仍执行基础边界保护：命令不经过 shell 拼接、归档和产物路径校验、下载大小/超时限制、工作区隔离、入口必须位于插件目录。生产运行不应向容器挂载宿主 Docker socket；不可信插件需要后续 Docker/Kubernetes Runtime 的网络、权限和资源隔离。
