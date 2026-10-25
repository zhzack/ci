# CI 流水线说明

项目的持续集成由 GitHub Actions 承载，配置文件为 [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)。**所有编译、lint、测试都运行在 GitHub 托管的云端服务器上**（GitHub-hosted Runner），本地机器不参与计算。

## 1. 触发规则

```yaml
on:
  push:
    branches: [main, glm_test]   # 推送到这两个分支时触发
  pull_request:                   # 任何针对本仓库的 PR 也触发
```

同一分支连续 push 时，`concurrency` 配置会自动取消被取代的旧运行，只保留最新一次，避免排队堆积。

## 2. 任务矩阵

一次运行并行启动两个互相独立的 job：

| | backend | frontend |
| :--- | :--- | :--- |
| 运行环境 | Ubuntu VM + Python 3.12 | Ubuntu VM + Node 20 |
| 依赖安装 | `pip install -r requirements-lock.txt`（锁定版本）+ `pip install -e . --no-deps` | `npm ci`（`package-lock.json` 锁定） |
| 质量门禁 | `ruff check .` → `pytest --cov --cov-report=term-missing` | `tsc` → `eslint --max-warnings=0` → `vitest` → `vite build` |
| 超时 | 20 分钟（防挂死） | 20 分钟 |

两个 job 均以 `permissions: contents: read` 运行（只读令牌，流水线不会回写仓库）。

## 3. 运行环境（GitHub-hosted Runner）

- `ubuntu-latest` 是 GitHub 在 Azure 上托管的**临时虚拟机**（2 核 / 7 GB 内存 / 约 14 GB 磁盘）。每个 job 领到一台全新机器，结束后整台销毁——因此每次都是"干净环境从头构建"，能够暴露本地已装依赖所掩盖的问题（典型案例：`PySocks>=1.28` 不存在版本的约束笔误，本地经镜像源无约束安装未暴露，CI 首跑即失败）。
- 构建产物（如 `vite build` 的 dist）在运行结束后丢弃。当前流水线只做**质量门禁**，不包含发布/部署；若需产出 Docker 镜像或制品，需另行扩展 job 与 `actions/upload-artifact`。
- 运行历史与日志在仓库的 **Actions** 标签页查看：`https://github.com/zhzack/ci/actions`。

## 4. 依赖锁定（requirements-lock.txt）

后端依赖通过 [`requirements-lock.txt`](../requirements-lock.txt) 固定为精确版本（48 个包，含 dev 工具链），CI 不再"每次解析最新版"，杜绝 CI 与本地、以及 CI 与 CI 之间的版本漂移；前端由 `package-lock.json` + `npm ci` 保证同等语义。

**升级依赖的操作流程**：修改 `pyproject.toml` 中的版本约束 → 本地重新生成锁文件 → 提交两者：

```bash
pip-compile pyproject.toml --extra dev -o requirements-lock.txt \
  --resolver=backtracking --no-annotate --strip-extras --no-header
```

（pip-tools 生成；头部注释中亦附有同一命令。）

## 5. 缓存策略

- Python：`actions/setup-python` 的 `cache: pip`，缓存键跟随 `requirements-lock.txt` 的哈希——只有锁文件变化时才重新下载；
- Node：`actions/setup-node` 的 `cache: npm`，缓存键跟随 `frontend/package-lock.json`。

## 6. 覆盖率基线与门禁

- 2026-10-25 基线：**后端整体 70.5%**（11432 语句 / 3375 未覆盖，167 passed），前端无行覆盖率统计（15 个 vitest 用例）；
- 当前 CI 只**输出**覆盖率报告，不设 `--cov-fail-under` 阈值门禁。计划在补齐 scheduler / runner / email 等低覆盖模块后设阈值（建议先定 70% 防回退，再逐步上调）。

## 7. 费用

仓库为 public 时 GitHub Actions **完全免费、不限时长**；转 private 后免费额度为每月 2000 分钟（本流水线单次约 5 分钟，两 job 并行计较快的一条）。

## 8. 常见问题

- **本地全绿但 CI 失败**：优先怀疑依赖差异——本地 venv 与锁定文件是否一致（`pip install -r requirements-lock.txt --dry-run`），以及平台差异（Windows vs Ubuntu）；
- **查看某次失败的详细日志**：Actions 页面对应 run → 点击 job → 展开失败步骤；或用有权限的令牌调 API 下载日志归档。
