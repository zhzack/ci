# AGENTS.md

`Mini Pipeline` — FastAPI + React 流水线执行平台。完整上下文见 `CLAUDE.md`。

## 必须设置的环境变量和命令

```bash
# Python 虚拟环境（运行任何命令前必须先 source）
. .venv/bin/activate
pip install -e '.[dev]'

# 必须设置：不设的话服务端和测试都无法启动
export MINI_PIPELINE_CONFIG=config/default.yaml

# 后端
.venv/bin/pytest -q                                          # 跑全部测试（不能用 bare `pytest`）
.venv/bin/pytest tests/integration/test_v2_full_demo.py -q   # 跑单个集成测试
.venv/bin/ruff check .                                       # 代码检查

# 前端
cd frontend
npm install --legacy-peer-deps          # --legacy-peer-deps 是必须的，不能省略
npm run typecheck                       # tsc --noEmit（strict 模式，noExplicitAny 是 error）
npm run lint                            # eslint --max-warnings=0
npm run build                           # typecheck + vite build
```

## 容易踩的坑

- **配置文件中的环境变量展开是严格的**：YAML 里的 `${VAR}` 如果没设置，启动直接拒绝。`.env.example` 展示了需要的变量。
- **集成测试需要设置 `MINI_PIPELINE_CONFIG`**。`conftest.py` 提供了 `settings`、`client`、`plugin_zip` 三个共享 fixture。
- **示例插件的 run.sh 必须在集成测试引用之前 `chmod +x`**。
- **Shell Runtime 没有隔离**。生产环境需要用 Docker/K8s Runtime（见 docs 里的 docker.md）。
- **TypeScript `noExplicitAny` 是 error**，不是 warn。必须用正确的类型，或用 `unknown` + 类型收窄。
- **`@/*` 路径别名** 解析到 `src/*`（TypeScript 和 Vite 都生效）。
- **前端开发代理**：`/api` → `http://127.0.0.1:8000`，可通过 `VITE_API_TARGET` 覆盖。
- **Docker**：以非 root 的 `pipeline` 用户运行（UID 10001）。PostgreSQL 通过 `docker-compose.yml` 配置。

## Agent 容易忽略的架构细节

- **双线程池**：`coordinator_workers`（默认 2）推进 DAG；`task_workers`（默认 4）执行具体步骤。排查死锁时优先看这里。
- **v1 manifest 自动升级**：通过 `mini_pipeline/plugin/manifest.py` 里的 `_upgrade_v1_to_v2`，旧的 flat inputs/outputs 会自动转为 v2 契约。
- **表达式解析器**只允许 3 种访问路径：`params.<k>`、`steps.<dep>.outputs.<k>`、`all.deps.outputs.<k>`。其他写法都会抛异常。
- **工作目录布局是固定的**：`workspace/{input,output,temp,cache,logs}` + `context.json`。插件进程通过读取 `context.json` 获取解析后的输入。
- **产物下载是不透明引用**：API 使用 `artifact_id`，绝不暴露文件系统路径。
- **`toolhub/` 与 Pipeline 已打通**：toolhub 用 `plugin.yaml` 描述工具，与 Pipeline 插件格式兼容。Pipeline 的 `source/toolhub.py` 提供 `toolhub` source type，可从 toolhub 的 `index.json` 注册插件（配置 `hub`/`tool`/`channel`/`version`/`auth`）。修改 toolhub 代码时注意它内部用极简 YAML 解析器（`publish/parse_yaml.py`），无 PyYAML 依赖。

## 没有 CI/CD，也没有 pre-commit

本项目没有 GitHub Actions、没有 GitLab CI、没有 pre-commit hooks、也没有 Makefile。每次修改代码后，必须手动依次跑 `ruff check`、`npm run typecheck` 和 `npm run lint`。
