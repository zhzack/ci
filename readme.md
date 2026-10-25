# Mini Pipeline

[![CI](https://github.com/zhzack/ci/actions/workflows/ci.yml/badge.svg?branch=glm_test)](https://github.com/zhzack/ci/actions/workflows/ci.yml)

**轻量级流水线执行平台** —— 插件只是普通进程，流水线只是一个 YAML DAG。

| | |
| --- | --- |
| 当前版本 | `0.3.1`（变更明细见 [CHANGELOG](CHANGELOG.md)） |
| 后端 | Python 3.9+ · FastAPI · SQLAlchemy 2 · Pydantic v2 |
| 前端 | React 19 · Vite · TypeScript strict · Ant Design 5 · Dock Layout |
| 存储 | SQLite / PostgreSQL 16 · 本地文件 / S3 兼容对象存储（AWS / MinIO / OSS / R2） |
| 用户与安全 | 账户注册/登录、邮箱 OTP 验证码/快捷登录/找回密码、团队管理、资源授权共享 |
| 远程执行 | 多机网络：Pull 模式 Runner Agent（一键安装）+ SSH 直连免 Agent 模式 |
| 工作台 | 计算节点全功能 IDE 工作台（VS Code 级嵌套分栏、多开终端、远程文件、实时监控） |
| 制品与环境 | 通用制品仓库 Package Hub、多机批量环境装配下发（Provisioning）、全栈 Docker 双环境 |

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
- [制品仓库与存储驱动](#制品仓库与存储驱动)
- [邮件体系与安全认证](#邮件体系与安全认证)
- [全功能 IDE 模式与 Dock 布局](#全功能-ide-模式与-dock-布局)
- [鉴权与安全](#鉴权与安全)
- [REST API 摘要](#rest-api-摘要)
- [配置参考](#配置参考)
- [可观测性与运维](#可观测性与运维)
- [前端管理后台](#前端管理后台)
- [测试](#测试)
- [项目结构](#项目结构)
- [文档索引](#文档索引)

## 特性总览

**执行引擎**

- 四种 Runtime：`shell` / `python` / `node` / `executable`（`docker` 已在契约校验中预留，实现见 [roadmap](docs/roadmap.md)）；
- 墙钟超时、进程树终止（POSIX `killpg` / Windows `taskkill /T`）、Windows 下自动解析 shebang 经 Git Bash 执行；
- Step 级自动重试：`retries: n`，指数退避（基数 `retry_backoff_seconds`，单次上限 60s），`attempt` 持久化；
- 运行取消：`POST /api/runs/{id}/cancel`，运行中插件进程整树终止，未开始步骤置 `CANCELLED`；
- Branch run：从任意 step 分支重跑，复用上游已成功的输出。

**实时流式交互**

- `GET /api/runs/{id}/events`：run/task 状态 SSE 事件流（事件总线直推 + 周期性 DB 快照兜底，终态后服务端关流）；
- `GET /api/runs/{id}/tasks/{step}/log/stream`：任务日志 SSE tail 流（`log` + `end` 事件）。

**分布式远程执行**

- **双模式调度**：
  - **Pull 模式 Runner Agent**：基于出站 HTTP 长轮询原子认领任务，支持 15 秒心跳续租与孤儿租约收割（`LeaseReaper`）；
  - **Push 模式 SSH 直连**：免装 Agent，通过 Paramiko SFTP 打包下发与远程命令执行，支持机器实时连通性探测；
- **单指令自适应部署（`/install`）**：针对 Linux Shell 与 Windows PowerShell 自动下发单行安装脚本，带 Token 自动后台拉起，支持缺 Python 环境时的绿色运行时自愈；
- **机器分类管理**：个人机（个人接入/共享）与管理员机池（平台持有分配，机密凭证 Fernet 对称加密）；
- **环境批量装配（Provisioning）**：制品仓托管 Python/Node 绿色运行包，支持 Web 端勾选多台机器一键批量下发安装与进度追踪。

**通用制品仓库（Package Hub）与存储驱动**

- **多驱动存储后端**：本地文件驱动（`LocalStorageDriver`）与 AWS SigV4 兼容标准库 S3 驱动（`S3StorageDriver`，对接 AWS S3 / MinIO / OSS / COS / R2，零第三方 SDK 依赖）；
- **在线文件工作台**：目录层级树管理、文件拖拽上传/文件夹递归扫描、图片在线预览、Monaco 风格暗色代码在线编辑保存；
- **资产沉淀与跨租户分享**：支持将任意制品目录一键直接发布为平台插件；支持生成跨用户带时效的提取码分享链接（`/share/:token`）。

**邮件服务与安全认证体系（Email & OTP）**

- **异步发信引擎**：支持 SMTP / SSL / STARTTLS 加密通道（QQ 邮箱、163、企业微信等），多线程发信零阻塞主流程；
- **安全认证闭环**：邮箱验证码免密快捷登录、邮箱验证码安全注册、忘记密码验证码安全重置、个人设置换绑邮箱；
- **任务完成通知**：流水线调度结束自动异步发信给触发者，包含状态、运行耗时、错误摘要及直达详情链接；
- **管理员 SMTP 控制台**：在线可视化维护发信配置与一键在线连通性测试。

**计算节点全功能 IDE 模式与 Dock 布局工作台**

- **VS Code 级嵌套分栏引擎**：纯 TS/React 递归 `DockLayout` 引擎，支持 `SplitNode`（水平/垂直）与 `TabGroupNode` 无限嵌套；
- **5 区位拖拽停靠（Drop Preview）**：Tab 拖拽呈现半透明落点高亮（左/右/上/下/同级），松开鼠标瞬间拆分或合并；
- **SSH/SFTP 长连接复用池（Connection Pooling）**：后端统一长连接池，消除 30s 握手超时与 OpenSSH 连接风暴，远程文件与监控接口 10~30ms 毫秒级极速响应；
- **WinSCP 级全功能文件管理器**：支持全量物理磁盘分区挂载（C:/, D:/, F:/, G:/, H:/...）与容量/卷标监控；文件列表与左侧目录树鼠标右键全套操作（在线编辑/打开/下载/重命名/新建文件与文件夹/复制绝对路径/chmod 权限编辑/删除/桌面文件拖拽静默上传）；
- **Electerm 风格原生全双工 PTY 终端（Zero-Dependency Native PTY）**：零第三方 npm 依赖的自研 ANSI 256 / Truecolor / DEC 模式流式终端引擎；支持多 Tab 会话隔离与永久保活（`[终端 1] [终端 2] [+]`）、全平台退格键（`\x08` / `\x7f`）适配以及控制台与远程文件的全景双向联动（右键在终端直接 cd 进入目标目录 / 终端一键同步定位文件管理器）。

**多用户与团队协同**

- **动态用户与认证体系**：密码 `scrypt` 加盐哈希安全存储，**系统首位注册用户自动成为超级管理员**；首次登录强制修改密码保护；
- **团队（Teams）全功能管理**：团队创建、成员管理，支持将流水线与机器批量共享给指定团队或个人（viewer / operator 权限细分）；
- **操作审计**：关键变更与管理操作统一沉淀 `audit_logs` 审计追踪。

**平台底座**

- 插件注册五通道：Git / HTTP ZIP / 上传 ZIP / 文件夹上传 / toolhub 制品仓；
- 鉴权：动态 Session Token（`mpt_...`）+ 静态 API Token（Bearer / X-API-Key）+ `admin` / `reader` 角色；
- 可观测：`/health`（liveness）、`/health/ready`（readiness）、`/health/version`、`/metrics`（Prometheus）、text/JSON 结构化日志 + 全链路 RequestID；
- API 工程化：统一分页信封、写方法滑动窗口限流、CORS、GZip、OpenAPI tag 元数据；
- 可靠性：Alembic 迁移、启动孤儿收割（崩溃恢复）、保留策略 GC（`mini-pipeline-gc`）；
- 产物：sha256 ETag / `If-None-Match` 304 条件下载，支持本地盘与 S3 对象存储双模态切换。

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

## 制品仓库与存储驱动

Mini Pipeline 提供了开箱即用的企业级制品管理中心（Package Hub）与双模态存储驱动体系：

### 1. 双模态存储驱动（Storage Drivers）
- **本地目录驱动（LocalStorageDriver）**：零外部依赖，安全隔离在受管目录内，原生提供 Zip Slip 路径穿越防护、文件编码自适应探测与原子暂存写入；
- **S3 兼容对象存储驱动（S3StorageDriver）**：基于纯 Python 标准库手写 AWS SigV4 签名机制，**零外部 boto3 依赖**，无缝接入 AWS S3、MinIO、阿里云 OSS、腾讯云 COS、Cloudflare R2 等，支持流式分片上传与断点读取；
- **产物与制品双重持久化**：运行产物（`S3ArtifactStore`）与制品仓库共用同一套底层存储驱动底座，保证架构极简。

### 2. 在线文件工作台与插件沉淀
- **层级目录与拖拽上传**：Web 端支持递归扫描多层级文件夹拖拽上传，支持大文件流式直传；
- **Monaco 风格暗色在线编辑**：直接在线编辑 YAML、Shell、Python、JSON 脚本，按 `Ctrl+S` 秒级存盘；
- **一键发布为平台插件**：在任意包含 `plugin.yaml` 的制品目录点击「发布为插件」，平台自动执行 Manifest 校验并将其注册为平台正式插件；
- **带时效的跨租户安全分享**：支持为文件或文件夹生成专属分享链接（含提取码与过期时间），外部用户通过 `/share/:token` 页面免登录安全下载与预览。

## 邮件体系与安全认证

Mini Pipeline 集成了完备的异步邮件发信引擎与 OTP 认证生命周期闭环：

- **高性能异步发信**：底层基于线程池异步执行 SMTP 协议发信，不占用 FastAPI 主事件循环；支持 SSL（端口 465）与 STARTTLS（端口 587）加密通信；
- **邮箱免密快捷登录**：输入注册邮箱接收 6 位验证码，1 秒免密登录系统；
- **全生命周期安全闭环**：
  - 邮箱验证码注册新账号；
  - 忘记密码时通过邮箱验证码重置密码；
  - 个人设置页通过新邮箱验证码安全换绑；
  - 防刷机制：60 秒发信冷却限制、5 分钟验证码有效期、5 次连续失败强制废弃；
- **流水线运行结果通知**：任务调度结束后，自动向流水线创建者/触发者发送包含状态胶囊、运行时长、报错摘要与直达链接的 HTML 邮件报告；
- **管理员 SMTP 控制台**：平台 Admin 可在后台实时维护发件服务器配置并执行一键连通性测试。

## 全功能 IDE 模式与 Dock 布局

针对计算节点的运维与开发，平台在前端提供了深度集成的 **VS Code 级全功能 IDE 模式与 Dock 布局系统**：

### 1. 自研纯 TS/React 递归 Docking 引擎
- **无限嵌套分割**：支持 `SplitNode`（水平/垂直分割）与 `TabGroupNode`（标签页组）任意嵌套拆分；
- **5 区位 Drop Preview 与拖拽合并**：鼠标按住任意 Tab 拖拽至屏幕中央或边缘，呈现半透明停靠预览，松开瞬间完成分屏或合并为同级标签页；
- **布局预设与持久化**：内置「经典四象限 IDE」、「文件开发模式」、「运维监控模式」、「同级全标签页」、「四宫格网格」等预设模板，关闭后自动通过 LocalStorage 记忆恢复。

### 2. SSH / SFTP 全景长连接池（Connection Pooling）
- **长连接复用根治卡顿**：后端统一引入 `_get_ssh_and_sftp_client` 内存连接池与心跳保持机制，全景（Overview）、进程、网络、磁盘与 SFTP 文件系统全部共享单例 SSH Transport 长连接；
- **消除握手与连接风暴**：彻底解决 4s 轮询高频新建 SSH 触发的 Windows OpenSSH `MaxStartups` 限制与 30000ms 超时问题，远程操作响应时间缩短至 **10~30ms**。

### 3. WinSCP 级全功能远程文件管理器
- **全物理磁盘分区挂载**：抽屉打开时自动并发探测远端全量磁盘分区（C:/, D:/, F:/, G:/, H:/...），显示磁盘卷标、总容量与可用空间，支持顶部磁盘胶囊与目录树一键切换；
- **文件列表与左侧目录树右键上下文菜单（Context Menu）**：
  - 📝 **在线编辑**：在 Dock 分栏内直接打开 Monaco 风格暗色代码编辑器实时修改保存；
  - 📁 **进入目录** / 💻 **在终端中打开此目录**（直接切换控制台并自动执行 `cd` 目标路径）；
  - ⬇️ **下载** / ✏️ **重命名** / 📋 **复制绝对路径** / 🔒 **POSIX 权限修改 (chmod)** / 🗑️ **删除**；
  - ➕ **在此新建文件 / 新建子文件夹**；
- **桌面拖拽上传（Drag & Drop）**：支持从操作系统桌面直接拖拽任意文件/文件夹至网页文件区域完成静默上传并自动刷新；
- **实时过滤检索**：支持输入关键字即时过滤当前目录文件。

### 4. Electerm 风格原生全双工 PTY 终端（Zero-Dependency Native PTY）
- **零依赖自研终端引擎**：无需安装庞大的第三方 xterm 库，自研高吞吐 ANSI 256 / Truecolor / DEC Private Mode 模式解析引擎与光标渲染；
- **多会话并发隔离与保活（Multi-Session Isolation）**：支持并发新建任意多个终端会话（`[终端 1] [终端 2] [终端 3] [+]`），各分配独立 `sessionId` 与独立 PTY 进程，切换或轮询持久保活不掉线；
- **全平台控制字符自适应**：精准识别 Windows ConPTY（`\x08` 退格码）与 Linux（`\x7f` DEL），支持 Backspace 退格删除、Delete 键与方向键控制；
- **控制台与远程文件深度双向联动**：
  - **文件 -> 终端**：文件表格与目录树右键一键「在终端中打开此目录」；终端顶部提供 `[⚡ 进入文件目录]` 快捷按钮；
  - **终端 -> 文件**：终端自动捕获命令行提示符工作目录，提供 `[📁 定位到文件]` 按钮，一键让文件管理器同步定位到终端所在路径；
  - **路径快捷填入**：提供 `[📂 插入路径]` 下拉菜单，直接将文件管理器中的文件绝对路径填入终端当前光标位置。

## 鉴权与安全

平台采用 **动态用户会话（Session Token）** 与 **静态密钥（API Token）** 双轨安全认证：

### 1. 动态用户体系
- **首位用户 Bootstrap**：全新安装的系统中，**首个注册的用户自动成为超级管理员（Admin）**，拥有平台所有管理特权；
- **密码安全哈希**：基于 `scrypt` 算法（N=16384, r=8, p=1）+ 随机盐哈希，数据库绝不落地明文；
- **会话机制**：登录成功下发 `mpt_...` 会话令牌（数据库仅存储 SHA-256 哈希），有效期由 `auth.session_ttl_hours`（默认 72h）控制；
- **首次登录强制改密**：Admin 创建的初始账号或重置密码账号，登录时受全局强阻断弹窗保护，必须修改初始密码后方可进入系统；
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
| GET | `/install` · `/install.sh` · `/install.ps1` | 单指令自适应安装脚本分发 |
| GET | `/uninstall` · `/uninstall.sh` · `/uninstall.ps1` | 单指令一键卸载脚本分发 |
| POST | `/api/auth/register` · `/api/auth/login` | 账号注册与登录 |
| POST | `/api/auth/email/send-code` | 发送邮箱验证码（注册/登录/重置/换绑） |
| POST | `/api/auth/email/login` | 邮箱验证码免密快捷登录 |
| POST | `/api/auth/email/reset-password` | 邮箱验证码重置密码 |
| POST | `/api/auth/email/change-email` | 验证码绑定/更换邮箱 |
| GET · POST | `/api/machines` | 机器列表查询与接入注册 |
| POST | `/api/machines/{id}/test-connection` | 机器实时连通性探测（SSH/Agent） |
| GET | `/api/machines/{id}/diagnostics/**` | 机器全景、进程、网络、目录与文件读写接口 |
| GET · POST | `/api/packages/**` | 制品仓库目录遍历、上传、下载、在线编辑与分享 |
| POST | `/api/packages/publish-as-plugin` | 制品目录一键发布为平台插件 |
| GET · POST | `/api/environments/**` | 运行时环境包管理与多机器批量下发装配 |
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
│   ├── account/             # 账户与权限核心（密码哈希、Session、Grants、Teams、邮件 OTP、凭证加密）
│   ├── api/                 # 路由、鉴权、分页信封（流水线/机器/团队/制品/环境/插件）
│   ├── artifact/            # 产物存储（LocalArtifactStore / S3ArtifactStore，ETag/304）
│   ├── core/                # 配置、Services 装配、EventBus/取消注册表、日志
│   ├── database/            # ORM 模型、仓储（分页/收割/团队/机器/审计/制品）
│   ├── domain/              # v2 资源契约、状态机、异常、Runtime 协议
│   ├── executor/            # 任务执行、workspace 上下文、输出收集（含 v1 兼容）
│   ├── maintenance/         # mini-pipeline-gc
│   ├── pipeline/            # YAML schema、DAG、表达式、wiring 校验
│   ├── plugin/              # manifest（v1 自动升级）与注册服务
│   ├── runner/              # Pull 模式 Agent + Push 模式 SSH/SFTP 执行器
│   ├── runtime/             # ProcessRunner 底座 + shell/python/node/executable
│   ├── scheduler/           # 引擎（取消/重试/事件/邮件通知）、双线程池、LeaseReaper
│   ├── server/              # app 工厂、中间件、指标、单指令安装/卸载器（/install）
│   ├── source/              # git/http/upload/toolhub 来源 + 安全解压
│   └── storage/             # 通用制品存储子系统（LocalStorageDriver / S3StorageDriver）
├── frontend/                # React 19 管理后台（Vite + AntD 5 + 自研 Docking IDE）
│   ├── src/components/dock/ # 全局复用 VS Code 级递归嵌套分栏与拖拽停靠引擎
│   └── src/pages/           # 页面（机器全功能 IDE、制品仓库 Package Hub、流水线等）
├── deploy/                  # 生产环境非源码交付套件（纯镜像 Compose + 一键部署脚本）
├── examples/                # 17 个示例插件 + 4 个示例 Pipeline
├── migrations/              # Alembic 迁移
├── config/                  # default.yaml（开发）/ docker.yaml（生产）
├── toolhub/                 # 独立的 shell 工具分发系统（后端对接其 index.json）
├── tests/                   # unit/ + integration/（127 个测试全绿）
├── docs/                    # 架构、运维、路线图、非源码部署指南、Agent 规范
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
