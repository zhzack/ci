# 设计文档：多用户、机器注册与远程执行（0.3）

> 状态：已实现（Phase A + B + 商店基础）。本文记录最终落地的设计，作为后续演进的基线。

## 1. 需求回顾

1. **任务可指定运行机器**：提交 run 时选择目标机器；本机执行保留为内置 runner。
2. **机器注册组件**：机器分两类——
   - **管理员机（admin pool）**：管理员创建，可保存机密凭证（如 SSH 账号，Fernet 加密存储），**分配**给用户使用；被分配者可跑任务但**永远看不到凭证**；
   - **个人机（personal）**：用户自助注册，owner 拥有与平台管理员等同的机器管理权（共享、令牌轮换、吊销），可**转移归属**，可**共享给组内其他用户**。
3. **用户体系与权限**：注册/登录、会话、资源归属（机器/流水线/运行/插件）、授权（user/team × viewer/operator）。
4. **插件商店**：个人插件提交发布申请 → 管理员审批 → 公开可见；未批准前仅 owner 可见。机器不进商店。

## 2. 关键设计决策

| 决策 | 结论 | 理由 |
| --- | --- | --- |
| Runner 通信方向 | **pull 模型**：agent 只发出站 HTTPS（长轮询 claim + 心跳 + 回传） | 用户机器在 NAT 后，服务器无法入站连接；无需 SSH 凭据 |
| 任务队列 | **Postgres `SKIP LOCKED` 风格的 DB 认领**（`UPDATE ... WHERE status='QUEUED'` 守卫） | 不引入 Redis；单库事务天然防重复认领 |
| 远程任务等待 | 引擎侧轮询任务持久状态（`poll_interval_seconds`，默认 0.5s） | 复用现有 Future 语义，事件丢失不影响正确性 |
| 机器存活判定 | 租约：claim 时设置 `lease_expires_at`，心跳续期；后台 **LeaseReaper** 把过期 RUNNING 任务标记 FAILED | 断电/断网的 runner 不会让 run 永久悬挂 |
| 密码哈希 | stdlib `scrypt`（自描述格式 `scrypt$N$r$p$salt$hash`） | 零新依赖，参数可升级 |
| 凭证存储 | Fernet（`cryptography` 包），密钥 = `security.secret_key` | 管理员机的账号密码静态加密，仅 admin/owner 可解 |
| 本机执行 | machine_id 为 NULL → 走原双线程池 | 完全向后兼容，开发体验不变 |
| 数据库 | 生产 PostgreSQL；SQLite 保留给单人开发 | 迁移同时兼容两者（batch_alter_table） |

## 3. 数据模型（新增/变更）

```
users(id, username, password_hash, display_name, role: admin|user, status: active|disabled)
auth_sessions(id, user_id, token_hash, expires_at, last_seen_at)   -- token 只存 sha256
teams(id, name, created_by) / team_members(team_id, user_id)
share_grants(id, resource_type: pipeline|plugin|machine, resource_id,
             grantee_type: user|team, grantee_id, permission: viewer|operator, granted_by)
machines(id, name, kind: admin|personal, owner_id, assigned_user_id, labels,
         max_concurrency, token_hash, credentials(加密), status: active|revoked, last_heartbeat)
audit_logs(id, user_id, action, resource_type, resource_id, detail, request_id)
-- 存量表：
plugins        + owner_id(NULL=平台插件，全员可见), visibility, review_status
pipelines      + owner_id
pipeline_runs  + owner_id, machine_id
task_runs      + machine_id, lease_expires_at；状态机增加 QUEUED
```

**兼容语义**：`owner_id IS NULL` 的存量资源视为「平台资源」，对所有人可见可跑——升级不破坏既有部署。

## 4. 权限模型

| 操作 | 平台 admin | owner | operator grant | viewer grant | 被分配者(admin 机) |
| --- | --- | --- | --- | --- | --- |
| 查看 pipeline/plugin | ✓ | ✓ | ✓ | ✓ | — |
| 运行 pipeline | ✓ | ✓ | ✓ | ✗ | — |
| 编辑/删除 pipeline | ✓ | ✓ | ✗ | ✗ | — |
| 运行任务到 machine | ✓ | ✓ | ✓ | ✗ | ✓ |
| 查看 machine 凭证 | ✓ | ✓(仅 personal) | ✗ | ✗ | ✗ |
| 转移/吊销 machine | ✓ | ✓(仅 personal) | ✗ | ✗ | ✗ |
| 商店审批 | ✓ | ✗ | ✗ | ✗ | — |

隐式授权：**运行被共享的 pipeline 自动获得其引用插件的使用权**（否则共享流水线无意义）。

首个注册用户自动成为平台 admin（bootstrap）；注册开关 `auth.registration_enabled`。

## 5. Runner 协议（/api/runner，`mrt_` 机器令牌）

| 端点 | 方向 | 说明 |
| --- | --- | --- |
| `POST /api/runner/tasks/claim` | agent → server | 原子认领最老的 QUEUED 任务（无任务 204）；认领即 RUNNING + 租约 |
| `GET /api/runner/tasks/{id}/bundle` | agent → server | 下载任务包：插件目录 + 已解析的 workspace（input/ 树 + input.json + context.json） |
| `POST /api/runner/tasks/{id}/logs` | agent → server | 追加日志块（写入服务端日志文件，SSE 日志流自动生效） |
| `POST /api/runner/tasks/{id}/artifacts` | agent → server | multipart 上传产物；服务端经 ArtifactStore 落库 |
| `POST /api/runner/tasks/{id}/status` | agent → server | 终态回报（SUCCESS/FAILED/CANCELLED）+ outputs |
| `POST /api/runner/heartbeat` | agent → server | 续租 + 上报活跃任务 + 领取取消指令（返回 cancel_task_ids） |

Agent 本体：`mini-pipeline-runner --server <url> --token mrt_…`。与服务器共享同一个 Python 包（复用 ProcessRunner / collector / manifest），心跳默认 15s，claim 轮询 1.5s。

**取消链路**：用户取消 run → run 置 CANCELLED → agent 心跳响应携带 cancel_task_ids → agent 终止进程树 → 回报 CANCELLED。

## 6. 插件商店

- 插件级状态：`visibility: private|public` × `review_status: none|pending|approved|rejected`；
- `POST /api/plugins/store/publish`（owner）→ pending；
- `POST /api/plugins/store/review?approve=`（admin）→ approved（public）/ rejected（private）；
- 商店目录 `GET /api/plugins/store`：approved public + 自己的资源；
- 安全前提：公开插件会被他人机器执行，**上架审批是当前唯一的准入闸门**；Docker Runtime（roadmap Phase 2）落地后建议强制公开插件声明容器化运行。

## 7. 已知边界与后续工作

- 机器共享目前是 user 级 operator 授权；team 基础设施已就绪，UI 待接；
- 文件中转走服务器本地盘；S3/MinIO ArtifactStore（roadmap）落地后预签名下载可卸掉 API 带宽；
- 审计已覆盖注册/上传/提交/取消/授权/转移等 mutating 操作，报表 UI 在 admin 页逐步补充；
- runner 的 bundle 在服务端内存驻留至任务终态（`engine.remote_inputs`），服务重启即失效（与孤儿收割语义一致）。
