# IMFL Tool Hub — 使用说明

## 语法速查

所有操作都通过 `toolhub.sh` 这一个脚本完成：

```
./toolhub.sh <工具名>[@版本] [--channel 通道] [传给工具的参数...]
```

### 消费方（使用工具）

```bash
./toolhub.sh sync download                    # 运行 sync 工具，子命令 download
./toolhub.sh sync list                        # 运行 sync 工具，子命令 list
./toolhub.sh sync --config my.json upload     # --config 是传给 sync 的参数
```

### 发布方（发布工具）

```bash
./toolhub.sh publish <要发布的工具名> <通道> <版本号>
```

`publish` 是一个工具（放在制品仓的 `publish.sh`），它的作用是打包并上传其他工具。

```bash
# 发布 sync 的测试版
./toolhub.sh publish sync testing v1.1.0-beta.1
#            │        │    │       │
#            │        │    │       └── 版本号
#            │        │    └── 通道（stable / testing）
#            │        └── 要发布哪个工具（这里发布 sync）
#            └── toolhub 运行 publish.sh 这个工具
```

---

## 消费方操作

### 基本用法

```bash
# stable 通道最新版
./toolhub.sh sync --config app/sync/sync.json download

# testing 通道最新版
./toolhub.sh sync --channel testing --config app/sync/sync.json download

# 锁定版本
./toolhub.sh sync@v1.0.0 --config app/sync/sync.json download
```

### 传给工具的 `--config` ≠ toolhub 的 `--channel`

| 参数 | 谁消费 | 含义 |
|------|--------|------|
| `--channel testing` | toolhub.sh | 从 testing 通道拉取工具 |
| `--config app/sync/sync.json` | sync.py | sync 自己的项目配置文件 |

```bash
#          toolhub 的参数     sync 的参数
./toolhub.sh sync --channel testing --config app/sync/sync.json download
#                          ───────────────────────────────────────────
#                          全部传给 sync.py
```

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `IMFL_TOOL_CHANNEL` | 默认通道，等价于 `--channel` | `stable` |
| `IMFL_TOOL_CACHE` | 缓存目录 | `~/.cache/imfl-tools` |
| `IMFL_PRJ_ROOT` | 项目根路径 | toolhub.sh 所在目录 |
| `TOOLHUB_HUB` | 制品仓地址 | Artifactory `TEST/zz/tools/` |
| `TOOLHUB_AUTH` | HTTP Basic Auth | `user_download:Hsx2022@` |
| `IMFL_TOOL_OFFLINE` | 离线模式：`1`=跳过所有网络请求，仅用缓存 | `0` |

### 缓存与离线

工具和 index.json 会缓存到 `~/.cache/imfl-tools/`，切换版本时秒开。

**网络故障时的降级策略**：

| 场景 | 行为 | 输出 |
|------|------|------|
| index.json TTL 过期 + 网络不通 | 使用过期缓存 | `WARN: using stale index cache (600s old)` |
| 工具下载失败 + 该版本已有缓存 | 用缓存版本 | `WARN: download failed, using cached ...` |
| 工具下载失败 + 有其他版本缓存 | 降级到其他版本 | `WARN: falling back to cached ...` |
| 无网络 + 无缓存 | 报错退出 | `ERROR` |

**离线模式** `IMFL_TOOL_OFFLINE=1`：

跳过所有网络请求，仅使用本地缓存：

```bash
# 离线使用
IMFL_TOOL_OFFLINE=1 ./toolhub.sh sync list

# 离线 + 无缓存 → 直接报错
IMFL_TOOL_OFFLINE=1 ./toolhub.sh sync list
# → [toolhub] ERROR: offline mode — no index.json cache available
# →         run once online to create cache, then retry with offline
```

工具箱生命周期：

```
首次在线运行  →  下载并缓存 index.json + 工具 tar.gz
后续在线运行  →  TTL 内用缓存，过期后刷新
网络断开      →  自动降级使用过期缓存
离线模式      →  完全跳过网络，仅用缓存
```

### 工具自动获得的环境变量

| 变量 | 值 | 示例 |
|------|-----|------|
| `IMFL_PRJ_ROOT` | 项目根路径 | `/data/project-a` |
| `TOOLHUB_TOOL_NAME` | 运行的工且名 | `sync` |
| `TOOLHUB_TOOL_VERSION` | 解析到的版本 | `v1.0.1` |
| `TOOLHUB_TOOL_CHANNEL` | 解析到的通道 | `stable` |

---

## 发布方操作

### 命令一览

```bash
# 发布测试版：上传 tar.gz + 写入 index.json testing 通道
./toolhub.sh publish <工具名> testing <版本号>

# 发布正式版：上传 tar.gz + 写入 index.json stable 通道
./toolhub.sh publish <工具名> stable <版本号>

# 提升为正式版：把 testing 中的已有版本复制到 stable 通道
./toolhub.sh publish promote <工具名> <版本号>

# 查看注册表状态
./toolhub.sh publish status
```

### 示例

```bash
# 发布 sync 的测试版（版本号 v1.1.0-beta.1）
./toolhub.sh publish sync testing v1.1.0-beta.1

# 测试通过后，提升为正式版（不重新打包，直接登记到 stable）
./toolhub.sh publish promote sync v1.1.0-beta.1

# 发布正式版（直接发 stable）
./toolhub.sh publish sync stable v1.1.0
```

### publish 工具自更新

publish.sh 本身也是一个工具（名为 `publish`），也能通过 toolhub 更新自己：

```bash
./toolhub.sh publish publish stable v1.1.0
#            │        │      │       │
#            │        │      │       └── 版本号
#            │        │      └── 通道
#            │        └── 要发布的工具叫 publish（就是自己）
#            └── toolhub 运行 publish.sh
```

这里第一个 `publish` 是工具名（toolhub 去拉取 `publish.sh`），第二个 `publish` 是告诉 `publish.sh`"你要打包发布的工具名叫 publish"。

---

## 通用形式总结

```
./toolhub.sh <A> <B> ...
             └┬┘ └─┬──────...
              │    └── 传给工具 <A> 的参数
              └── 从制品仓拉取的工具名
```

例子对照：

| 命令 | A (工具名) | B... (传给工具的) |
|------|-----------|-------------------|
| `./toolhub.sh sync list` | `sync` | `list` |
| `./toolhub.sh publish sync stable v1.0` | `publish` | `sync stable v1.0` |
| `./toolhub.sh hello-tool arg1 --flag` | `hello-tool` | `arg1 --flag` |

---

## 如何添加新工具

每个工具源码目录下需要一个 `.toolhub.json` 描述文件 + 入口脚本：

```
tools-src/<工具名>/
├── .toolhub.json     ← 元信息：runtime, entry, env
├── <入口文件>          ← 入口脚本 (sync.py, run.sh, ...)
└── ...任意源码文件
```

`.toolhub.json` 格式：

```json
{
  "runtime": "python3",
  "entry": "sync.py",
  "env": {
    "MY_VAR": "${IMFL_PRJ_ROOT}/config"
  }
}
```

| 字段 | 说明 | 可选值 |
|------|------|--------|
| `runtime` | 执行器 | `"python3"`, `"bash"`, `""` (原生二进制) |
| `entry` | 入口文件相对于源码根目录的路径 | `"main.py"`, `"src/cli.sh"` |
| `env` | 注入的环境变量，`${IMFL_PRJ_ROOT}` 替换为项目根路径 | `{}` |

然后发布：`./toolhub.sh publish <工具名> stable v1.0.0`

---

## 使用场景

以下所有场景使用本地 PUT 服务器模拟真实 Artifactory。
从零开始（制品仓为空），覆盖发布方和消费方的完整操作。

### 环境准备

```bash
export TOOLHUB_HUB="http://localhost:18888/tools"
export TOOLHUB_AUTH=""

# 启动本地测试服务器（支持 GET + PUT）
python3 /tmp/toolhub_test_server.py &
```

---

### 场景 1：首次自举 — 发布 publish 自身

**制品仓状态**：空，什么都没有。

```bash
cd tools-src/
./toolhub.sh publish publish stable v1.0.0
```

**预期**：

```
[toolhub] index.json not found, using local tools-src/publish/ ...
[publish] packaging publish v1.0.0 from .../tools-src/publish...
[publish] uploading to .../publish/stable/v1.0.0/publish-v1.0.0.tar.gz...
[publish] index.json not found, creating new...
[publish] done: publish stable v1.0.0
```

**发生了什么**：
1. toolhub 请求 Artifactory → 404 → 制品仓还没有 index.json，toolhub fallback 到本地 `tools-src/publish/publish.sh`
2. publish.sh 打包 `tools-src/publish/` → PUT 到 `tools/publish/stable/v1.0.0/publish-v1.0.0.tar.gz`
3. publish.sh GET index.json → 404 → 自动创建 `{"version":1,"tools":{}}` → 写入 publish 的元信息 + 版本 → PUT 回 Artifactory

---

### 场景 2：发布正式版（sync）

**制品仓状态**：已有 publish v1.0.0。

```bash
cd tools-src/
./toolhub.sh publish sync stable v1.0.1
```

**预期**：

```
[toolhub] downloading publish@v1.0.0...
[toolhub] extracting...
[publish] packaging sync v1.0.1 from .../tools-src/sync...
[publish] uploading to .../sync/stable/v1.0.1/sync-v1.0.1.tar.gz...
[publish] updating index.json...
[publish] done: sync stable v1.0.1
```

**发生了什么**：
1. toolhub 从制品仓下载 `publish.sh`（不再需要本地 fallback）
2. publish.sh 读取 `tools-src/sync/.toolhub.json` → 得到 `runtime: python3`, `entry: sync.py`
3. 打包 `tools-src/sync/` → PUT Artifactory
4. 更新 index.json，写入 sync 的完整元信息 + stable 通道版本

---

### 场景 3：发布 bash 脚本工具（hello-tool）

```bash
cd tools-src/
./toolhub.sh publish hello-tool stable v1.0.0
```

**预期**：

```
[toolhub] using cached publish@v1.0.0
[publish] packaging hello-tool v1.0.0 from .../tools-src/hello-tool...
[publish] uploading to .../hello-tool/stable/v1.0.0/hello-tool-v1.0.0.tar.gz...
[publish] updating index.json...
[publish] done: hello-tool stable v1.0.0
```

**发生了什么**：与场景 2 相同。runtime=python3 还是 runtime=bash 对 publish 流程无区别，`toolhub.sh` 运行时会根据 `.toolhub.json` 的 `runtime` 字段选择执行器。

---

### 场景 4：发布 toolhub 自更新包

```bash
cd tools-src/
./toolhub.sh publish toolhub stable v1.0.0
```

**预期**：同场景 2/3。

---

### 场景 5：查看注册表

```bash
cd tools-src/
./toolhub.sh publish status
```

**预期**：

```
[publish] registry: http://localhost:18888/tools/index.json

  [hello-tool]
    stable:
      v1.0.0  →  hello-tool/stable/v1.0.0/hello-tool-v1.0.0.tar.gz
    testing: (empty)

  [publish]
    stable:
      v1.0.0  →  publish/stable/v1.0.0/publish-v1.0.0.tar.gz
    testing: (empty)

  [sync]
    stable:
      v1.0.1  →  sync/stable/v1.0.1/sync-v1.0.1.tar.gz
    testing: (empty)

  [toolhub]
    stable:
      v1.0.0  →  toolhub/stable/v1.0.0/toolhub-v1.0.0.tar.gz
    testing: (empty)
```

---

### 场景 6：发布 testing 版本

```bash
cd tools-src/
./toolhub.sh publish sync testing v1.1.0-beta.1
```

**预期**：

```
[publish] packaging sync v1.1.0-beta.1 ...
[publish] uploading to .../sync/testing/v1.1.0-beta.1/sync-v1.1.0-beta.1.tar.gz...
[publish] updating index.json...
[publish] done: sync testing v1.1.0-beta.1
```

**index.json 变化**：`sync.channels.testing` 新增 v1.1.0-beta.1。stable 不受影响。

---

### 场景 7：promote — testing 提为正式版

```bash
./toolhub.sh publish promote sync v1.1.0-beta.1
```

**预期**：

```
[publish] fetching index.json...
[publish] uploading updated index.json...
[publish] promoted: sync v1.1.0-beta.1 testing → stable
```

**index.json 变化**：sync.channels.stable 列表新增 v1.1.0-beta.1 版本记录（artifact 路径保持 testing 不变，不复制物理文件）。

---

### 场景 8：消费方 — 使用工具

```bash
cd consumer-a/
./toolhub.sh sync --config app/sync/sync.json list
```

**预期**：

```
[toolhub] downloading sync@v1.1.0-beta.1...
[toolhub] extracting...
[calib] type=folder archive=calib version=v1.0.0 ...
```

**发生了什么**：
1. toolhub GET index.json → 找到 sync → stable 通道 → 取列表头部 v1.1.0-beta.1（最新）
2. 下载 tar.gz → 解压到 `~/.cache/imfl-tools/sync/v1.1.0-beta.1/`
3. 注入 `SYNC_PROJECT_ROOT=${IMFL_PRJ_ROOT}` → 运行 `python3 sync.py --config app/sync/sync.json list`

---

### 场景 9：消费方 — 精确版本

```bash
cd consumer-a/
./toolhub.sh sync@v1.0.1 --config app/sync/sync.json list
```

**预期**：

```
[toolhub] using cached sync@v1.0.1    ← 如果之前下载过
[calib] type=folder archive=calib version=v1.0.0 ...
```

**发生了什么**：toolhub 遍历所有通道查找精确版本 v1.0.1，无论它在 stable 还是 testing。

---

### 场景 10：消费方 — bash 脚本工具

```bash
cd consumer-a/
./toolhub.sh hello-tool hello world
```

**预期**：

```
[toolhub] downloading hello-tool@v1.0.0...
[toolhub] extracting...
=== hello-tool v1.0.0 ===
runtime:     bash
prj_root:    .../consumer-a
args:        hello world
```

**发生了什么**：与场景 8 相同，但 runtime=bash → `exec bash run.sh hello world`。

---

### 场景 11：toolhub 自更新

```bash
cd consumer-a/
./toolhub.sh toolhub
```

**预期**：

```
[toolhub] self-update to v1.0.0...
[toolhub] self-update done: v1.0.0
[toolhub]   file : .../consumer-a/toolhub.sh
```

**发生了什么**：
1. toolhub 检测到工具名是 "toolhub" → 不执行正常的 "下载→运行" 流程
2. 下载 tar.gz → 解压 → 校验 bash 语法 → 用新版 toolhub.sh 覆盖当前文件
3. 下次运行时使用新版本

---

### 场景 12：消费方 — 切换通道

```bash
cd consumer-a/
./toolhub.sh sync --channel testing --config app/sync/sync.json list
```

**预期**：拉取 testing 通道最新版本（v1.1.0-beta.1），而不是 stable 通道的版本。

---

## 场景速查表

| # | 场景 | 命令 | 制品仓初态 | 关键验证点 |
|---|------|------|-----------|-----------|
| 1 | 首次自举 | `./toolhub.sh publish publish stable v1.0.0` | 空 | 自动创建 index.json |
| 2 | 发布 stable | `./toolhub.sh publish sync stable v1.0.1` | 有 publish | 从制品仓拉 publish.sh |
| 3 | 发布 bash 工具 | `./toolhub.sh publish hello-tool stable v1.0.0` | 有 publish | runtime=bash 无差别 |
| 4 | 发布 toolhub 包 | `./toolhub.sh publish toolhub stable v1.0.0` | 有 publish | 为自更新准备 |
| 5 | 查看注册表 | `./toolhub.sh publish status` | — | 列出全部工具 |
| 6 | 发布 testing | `./toolhub.sh publish sync testing v1.1.0-beta.1` | — | testing 独立列表 |
| 7 | promote | `./toolhub.sh publish promote sync v1.1.0-beta.1` | — | 不复制 tar.gz |
| 8 | 消费 latest | `./toolhub.sh sync list` | — | stable 最新版 |
| 9 | 消费 @版本 | `./toolhub.sh sync@v1.0.1 list` | — | 跨通道精确匹配 |
| 10 | 消费 bash 工具 | `./toolhub.sh hello-tool arg` | — | bash runtime |
| 11 | 自更新 | `./toolhub.sh toolhub` | — | 原地替换自身 |
| 12 | 切换通道 | `./toolhub.sh sync --channel testing list` | — | testing 优先 |
| 13 | 网络断开兜底 | `./toolhub.sh sync list` | 已缓存 | 过期 index + 缓存工具兜底 |
| 14 | 离线模式 | `IMFL_TOOL_OFFLINE=1 ./toolhub.sh sync list` | 已缓存 | 跳过网络，仅用缓存 |
| 15 | 离线无缓存 | `IMFL_TOOL_OFFLINE=1 ./toolhub.sh sync list` | 无缓存 | 明确报错需在线一次 |

---

### 场景 13：网络断开 — 缓存兜底

**前提**：工具之前已在线下载过，`~/.cache/imfl-tools/` 中有缓存。

```bash
# 制品仓不可达（网络断开 / 服务宕机）
./toolhub.sh hello-tool test
```

**预期**：

```
[toolhub] WARN: using stale index cache (600s old)
[toolhub] using cached hello-tool@v1.0.0
=== hello-tool v1.0.0 ===
```

**发生了什么**：
1. index.json TTL 过期，尝试刷新 → 网络不通
2. 检测到本地有 index.json 缓存 → 使用过期缓存
3. 工具缓存命中 → 直接运行

---

### 场景 14：离线模式

```bash
IMFL_TOOL_OFFLINE=1 ./toolhub.sh sync --config app/sync/sync.json list
```

**预期**：跳过所有网络请求，直接从缓存运行。

**发生了什么**：
1. `IMFL_TOOL_OFFLINE=1` → toolhub 不发起任何 curl 请求
2. index 缓存存在 → 直接用
3. 工具缓存存在 → 直接用

---

### 场景 15：离线模式 + 无缓存

```bash
IMFL_TOOL_OFFLINE=1 ./toolhub.sh sync list
```

**预期**：

```
[toolhub] ERROR: offline mode — no index.json cache available
[toolhub]        run once online to create cache, then retry with offline
```

**发生了什么**：没有 index 缓存 → 报错退出，提示先在线运行一次。

---

## 目录说明

```
_toolhub_test/
├── PLAN.md                     ← 设计文档（架构、schema、流程）
├── README.md                   ← 本文档
├── local-repo/tools/           ← 【模拟制品仓】index.json + tar.gz
├── tools-src/                  ← 【发布方】工具源码 + publish.sh
├── consumer-a/                 ← 【消费方 A】只有 toolhub.sh + 项目配置
└── consumer-b/                 ← 【消费方 B】只有 toolhub.sh + 项目配置
```
