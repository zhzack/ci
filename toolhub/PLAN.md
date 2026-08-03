# IMFL Tool Hub — 设计文档

## 1 概述

IMFL Tool Hub 是一个轻量级内部工具分发系统，解决"多个项目仓库需要共用同一套脚本工具"的问题。工具发布到制品仓（Artifactory），消费方通过一个引导脚本按需拉取，不把工具源码提交到业务仓库。

### 三方角色

| 角色 | 做什么 | 示例 |
|------|--------|------|
| **发布方** (Publisher) | 开发、维护工具源码；打包上传到制品仓；维护 index.json 注册表 | `tools-src/` |
| **制品仓** (Registry) | 存储 index.json 和工具 tar.gz；接收发布方的 PUT，响应消费方的 GET | Artifactory `TEST/zz/tools/` |
| **消费方** (Consumer) | 通过 toolhub.sh 拉取工具、运行；只提交项目配置，不提交工具源码 | `consumer-a/`, `consumer-b/` |

---

## 2 架构

```
                    publish.sh 读写 index.json + PUT tar.gz
  ┌─────────┐    ─────────────────────────────────────────→    ┌──────────────┐
  │ 发布方     │                                                 │   制品仓       │
  │tools-src │    ←─────────────────────────────────────────    │  local-repo   │
  └─────────┘    toolhub.sh GET index.json + tar.gz              └──────────────┘
       │                                                              │
       │  toolhub.sh                                                   │  toolhub.sh
       │  (自更新 publish.sh)                                            │  (GET + 缓存 + 运行)
       │                                                               │
       ▼                                                               ▼
  ┌─────────┐                                                   ┌─────────────┐
  │ 发布方     │                                                   │ 消费方 A      │
  │ 本身也是   │                                                   │ consumer-a   │
  │ 消费方     │                                                   └─────────────┘
  └─────────┘                                                   ┌─────────────┐
                                                                 │ 消费方 B      │
                                                                 │ consumer-b   │
                                                                 └─────────────┘
```

### 数据流

```
publish.sh 发布 sync v1.1.0:

  ① tar -czf sync-v1.1.0.tar.gz sync/        ← 打包工具源码
  ② curl PUT tar.gz → 制品仓                    ← 上传产物
  ③ curl GET index.json                         ← 拉取当前注册表
  ④ 往 channels 对应列表头部插入新版本             ← 更新注册表
  ⑤ curl PUT index.json                         ← 写回注册表

toolhub.sh 消费 sync:

  ① curl GET index.json                         ← 查可用版本
  ② 根据 channel + version 策略匹配目标版本        ← 版本解析
  ③ 检查本地缓存 ~/.cache/imfl-tools/             ← 避免重复下载
  ④ curl GET tar.gz → 解压到缓存                   ← 下载 + 缓存
  ⑤ 注入环境变量 → exec runtime entry args        ← 运行
```

---

## 3 制品仓规范

### 3.1 目录结构

```
TEST/zz/tools/                              ← 环境变量 TOOLHUB_HUB 指向的根
│
├── index.json                              ← 全局注册表
│
├── <tool-name>/                            ← 每个工具一层目录
│   ├── stable/                             ← 正式通道
│   │   ├── v1.0.0/<tool>-v1.0.0.tar.gz
│   │   └── v1.0.1/<tool>-v1.0.1.tar.gz
│   └── testing/                            ← 测试通道
│       ├── v1.1.0-beta.1/<tool>-v1.1.0-beta.1.tar.gz
│       └── v1.1.0-rc.1/<tool>-v1.1.0-rc.1.tar.gz
```

### 3.2 路径规范

```
${TOOLHUB_HUB}/<tool>/<channel>/<version>/<tool>-<version>.tar.gz
```

### 3.3 index.json Schema

```json
{
  "version": 1,
  "tools": {
    "<tool-name>": {
      "name": "<tool-name>",
      "description": "...",
      "runtime": "python3 | bash | ''",
      "entry": "入口文件在 tar.gz 中的相对路径",
      "type": "tar | single",
      "env": { "KEY": "value or ${IMFL_PRJ_ROOT}" },
      "channels": {
        "stable": [
          { "version": "v1.0.1", "artifact": "sync/stable/v1.0.1/sync-v1.0.1.tar.gz" }
        ],
        "testing": [ ... ]
      }
    }
  }
}
```

字段说明：

| 字段 | 层级 | 必填 | 说明 |
|------|------|------|------|
| `tools.<name>` | 根 | ✅ | 工具注册，key 即工具名 |
| `runtime` | 工具 | ✅ | `"python3"` `"bash"` `""` (原生二进制) |
| `entry` | 工具 | ✅ | tar.gz 解压后入口相对路径 |
| `type` | 工具 | ✅ | `"tar"` 或 `"single"` |
| `env` | 工具 | ❌ | 运行时注入的环境变量 |
| `channels.<name>` | 工具 | ✅ | 至少包含 `stable` |
| `channels.<name>[].version` | 版本 | ✅ | semver 版本号 |
| `channels.<name>[].artifact` | 版本 | ✅ | tar.gz 相对路径 |

### 3.4 index.json 谁管理

`index.json` 存储在制品仓，**由 publish.sh 通过"读-改-写"自动维护**。开发者不直接编辑它。
发布流程中 publish.sh 自动完成 GET → 修改 → PUT。

### 3.5 权限

| 操作 | 账号 |
|------|------|
| GET index.json / tar.gz | `user_download`（只读，公开） |
| PUT tar.gz / index.json | 发布账号（有写权限） |

---

## 4 版本与通道

### 4.1 通道模型

```
stable                          testing
  ├── v1.0.0                      ├── v1.1.0-dev.abc1234
  ├── v1.0.1  ← 默认通道           ├── v1.1.0-beta.1
  └── ...                         ├── v1.1.0-rc.1
                                  └── ...  ← 按 semver 排序取最大
```

### 4.2 版本匹配规则（toolhub.sh）

| 输入 | 行为 |
|------|------|
| `./toolhub.sh sync` | stable 通道 → semver 排序 → 取最大 |
| `./toolhub.sh sync --channel testing` | testing 通道 → semver 排序 → 取最大 |
| `./toolhub.sh sync@v1.0.0` | 遍历所有通道精确匹配 |
| `IMFL_TOOL_CHANNEL=testing ./toolhub.sh sync` | 环境变量覆盖通道 |

### 4.3 Semver 排序规则

```
v1.0.0 < v1.0.1 < v1.1.0-alpha.1 < v1.1.0-beta.1 < v1.1.0-rc.1 < v1.1.0
```

### 4.4 版本号规范

| 阶段 | 版本号示例 | 通道 |
|------|-----------|------|
| 开发 | `v1.1.0-dev.abc1234` | `testing` |
| Alpha | `v1.1.0-alpha.1` | `testing` |
| Beta | `v1.1.0-beta.1` | `testing` |
| RC | `v1.1.0-rc.1` | `testing` |
| 正式 | `v1.1.0` | `stable` |
| 热修复 | `v1.1.1` | `stable` |

---

## 5 toolhub.sh 规范

### 5.1 定位

消费方唯一需要提交的通用引导脚本。不依赖任何第三方工具链（仅 curl、tar、python3 做 JSON 解析）。

### 5.2 命令行接口

```
toolhub.sh <tool>[@<version>] [--channel <name>] [tool args...]
```

### 5.3 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `TOOLHUB_HUB` | Artifactory `TEST/zz/tools` | 制品仓地址 |
| `TOOLHUB_AUTH` | `user_download:Hsx2022@` | HTTP Basic Auth |
| `IMFL_PRJ_ROOT` | toolhub.sh 所在目录 | 项目根路径 |
| `IMFL_TOOL_CHANNEL` | `stable` | 默认通道 |
| `IMFL_TOOL_CACHE` | `~/.cache/imfl-tools` | 本地缓存根目录 |

### 5.4 本地缓存

```
~/.cache/imfl-tools/
├── <tool>/
│   └── <version>/
│       ├── <entry>
│       ├── ... (解压出的所有文件)
│       └── .extracted          ← 标记文件，确认解压完整
└── .index_cache                ← index.json 缓存（5分钟TTL）
```

### 5.5 内部流程

```
① 解析 args: tool[@version] [--channel <name>]
② GET index.json（优先使用本地缓存，过期则重新拉取）
③ 版本解析:
   - 有 @version → 精确匹配，遍历所有通道
   - 无 @version → 使用当前通道 → semver 排序取最大
④ 检查缓存: ~/.cache/imfl-tools/<tool>/<version>/.extracted
   - 存在 → 跳过下载
   - 不存在 → curl 下载 tar.gz → tar xzf 解压 → touch .extracted
⑤ 注入 env（index.json 里声明的变量，${IMFL_PRJ_ROOT} 替换为值）
⑥ exec <runtime> <缓存路径>/<entry> [tool args...]
```

---

## 6 publish.sh 规范

### 6.1 定位

发布方工具，负责打包工具源码、上传制品仓、维护 index.json。

### 6.2 命令行接口

```
publish.sh <tool> <channel> <version>     # 发布指定版本
publish.sh promote <tool> <version>       # 从 testing 提升到 stable
publish.sh status                         # 查看当前注册表
```

### 6.3 配置 (.publishrc)

```bash
TOOLHUB_HUB="https://ciartifactory-prd.ap.immotors.com/artifactory/TEST/zz/tools"
TOOLHUB_AUTH="user_download:Hsx2022@"
# 发布专用账号（如需要独立权限）
# PUBLISH_USER="..."
# PUBLISH_PASS="..."
```

### 6.4 内部流程

```
publish <tool> <channel> <version>:

  ① 校验: 工具源码目录 tools-src/<tool>/ 存在
  ② 打包: tar -czf <tool>-<version>.tar.gz -C <tool> .
           自动排除: __pycache__/ .git/ *.pyc .DS_Store
  ③ PUT tar.gz → ${TOOLHUB_HUB}/<tool>/<channel>/<version>/<tool>-<version>.tar.gz
  ④ GET index.json
  ⑤ 往 tools.<tool>.channels.<channel> 列表头部插入新版本记录
  ⑥ PUT index.json
```

```
promote <tool> <version>:

  ① GET index.json
  ② 在 testing 通道找到该版本
  ③ copy artifact 路径: testing → stable
  ④ 往 stable 列表头部插入相同版本记录
  ⑤ PUT index.json
```

### 6.5 发布检查清单

- [ ] CHANGELOG.md 已更新
- [ ] 版本号符合 semver
- [ ] 本地测试通过
- [ ] 正式版已打 git tag

---

## 7 自更新机制

`publish.sh` 本身也是通过 toolhub 分发和更新的。

### 原理

```
发布方仓库 tools-src/ 里:

  toolhub.sh              ← 引导脚本（唯一固定文件）
  publish/publish.sh      ← publish 脚本源码

流程:

  ./toolhub.sh publish publish stable v1.1.0
      │
      ├→ toolhub.sh 从缓存运行旧版 publish.sh
      │
      └→ 旧版 publish.sh:
           ├ 打包 publish/ 目录 (= 新版本的 publish.sh)
           ├ PUT tar.gz → 制品仓
           ├ GET index.json → 更新 publish 版本 → PUT
           └ done

下一次运行时 toolhub.sh 自动拉取最新的 publish.sh（stable 通道）。
```

发布方仓库自身也是一个消费方——用 toolhub.sh 运行 publish.sh。

---

## 8 消费方使用约定

### 8.1 项目结构

```
项目仓库/
├── toolhub.sh                    ← 提交
├── app/
│   └── <tool>/
│       ├── <config>.json         ← 提交（项目专属配置）
│       └── ...                   ← 工具生成的目录（.gitignore）
└── .gitignore                    ← 忽略 toolhub 缓存文件
```

### 8.2 使用方式

```bash
# 默认 stable 通道最新版
./toolhub.sh sync --config app/sync/sync.json download

# testing 通道
./toolhub.sh sync --channel testing --config app/sync/sync.json download

# 锁定版本
./toolhub.sh sync@v1.0.0 --config app/sync/sync.json download

# 其他工具
./toolhub.sh <other-tool> [args...]
```

---

## 9 环境变量一览

| 变量 | 用途 | 默认值 |
|------|------|--------|
| `TOOLHUB_HUB` | 制品仓地址 | Artifactory `TEST/zz/tools/` |
| `TOOLHUB_AUTH` | HTTP Basic Auth | `user_download:Hsx2022@` |
| `IMFL_PRJ_ROOT` | 项目根路径 | toolhub.sh 所在目录 |
| `IMFL_TOOL_CHANNEL` | 默认通道 | `stable` |
| `IMFL_TOOL_CACHE` | 缓存根目录 | `~/.cache/imfl-tools` |
| `SYNC_PROJECT_ROOT` | sync 工具专用 | `${IMFL_PRJ_ROOT}` |

---

## 10 测试目录说明

```
_toolhub_test/
├── PLAN.md               ← 本文档
├── README.md             ← 使用说明
├── local-repo/tools/     ← 模拟制品仓（本地文件系统）
├── tools-src/            ← 发布方（工具源码 + publish.sh）
├── consumer-a/           ← 消费方 A
└── consumer-b/           ← 消费方 B
```
