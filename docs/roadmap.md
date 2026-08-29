# Roadmap

本文是后续演进的计划基线。已完成能力见 `CHANGELOG.md` 与 `readme.md`。

## 状态总览

| 能力 | 状态（0.2） |
| --- | --- |
| 鉴权（token + admin/reader 角色） | ✅ 已完成 |
| Alembic 迁移 | ✅ 已完成 |
| 结构化日志 / RequestID / Prometheus 指标 / 就绪探针 | ✅ 已完成 |
| 分页信封、限流、CORS、GZip、OpenAPI 定制 | ✅ 已完成 |
| 运行取消 + 进程树终止 | ✅ 已完成 |
| Step 级重试 + 指数退避 | ✅ 已完成 |
| SSE run 事件流 + 日志流 | ✅ 已完成 |
| 产物 ETag/304 缓存 | ✅ 已完成 |
| 崩溃恢复（孤儿收割） | ✅ 已完成 |
| 保留策略 GC 脚本 | ✅ 已完成 |
| 前端暗色主题 / SSE 日志 / 服务端分页 | ✅ 已完成 |

## Phase 2 — 执行底座强化（下一个周期）

1. **Docker Runtime**（`runtime: docker` 已在 manifest 校验中预留）
   - 以容器方式执行插件：image 解析、workspace bind-mount、非 root 运行、
     进程组 = 容器（取消 = container stop）；
   - 资源限制（cpu/memory/pids）与网络策略（默认 no-network）；
   - 测试策略：本地 docker-in-test 仅在 CI 有 Docker 时执行（skip guard）。
2. **S3/MinIO ArtifactStore**
   - `ArtifactStore` 协议已抽象（`domain/artifact.py`），实现 `S3ArtifactStore`：
     分片上传、`artifact_id` 不变、下载走预签名 URL（降低 API 带宽）；
   - GC 脚本扩展对象生命周期策略。
3. **持久化队列 / Runner 分离**
   - 当前调度在 API 进程内（双线程池）。Phase 2 把 coordinator/task 抽象成
     Worker 进程 + 持久队列（Postgres `SKIP LOCKED` 起步，不引入 Redis），
     API 进程崩溃不再中断进行中的任务，并支持多机 Runner；
   - 取消信号从内存 Event 变为队列/DB 信号。
4. **任务级缓存（content-addressed execution）**
   - 复活并接好 content-hash 执行单元（`run_nodes` 思路）：相同
     plugin+params+inputs 的 step 直接复用历史输出，branch run 天然加速。

## Phase 3 — 平台化

1. **Webhook / 通知**：run 终态回调（含签名头），重试策略与退避同 step 重试一致。
2. **Pipeline 版本化**：definition 历史版本 + 回滚，run 记录引用的 definition 版本。
3. **Secrets 管理**：`secret:` 参数类型，值只写不读（API 返回掩码），插件经环境变量注入。
4. **多租户 / 项目空间**：plugin/pipeline/run 挂 namespace；鉴权从 token 表升级为
   user + project role。
5. **审计日志**：所有 mutating 请求落审计表（actor、request id、payload 摘要）。

## Phase 4 — 前端体验

1. **React Flow DAG 可视化**：`summarizeGraph` 契约已稳定，替换实现即可；
   节点实时状态直接吃 SSE 事件。
2. **Monaco YAML 编辑器**：schema 校验（params-schema 端点生成 JSON Schema）。
3. **运行页 Dashboard 化**：指标卡（duration P50/P95、失败率）直连 `/metrics`。

## 工程约束（长期有效）

- 每个 Phase 合并前：`scripts/check.sh` 全绿（ruff + pytest + 前端三件套）。
- API 变更保持 OpenAPI 标注完整；破坏性响应结构变更需在 `CHANGELOG.md` 标注 BREAKING。
- 迁移与模型同步演进，禁止改历史迁移文件。
