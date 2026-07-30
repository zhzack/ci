# Frontend

本目录是基于 React 19 + TypeScript + Vite + Ant Design 5 的轻量级流水线管理后台。前端
只承担展示与交互，不实现业务规则；所有数据都来自 `../mini_pipeline` 提供的 REST API。
本设计遵循 `简化流水线平台前端开发设计文档 v1.0` 的分层约定：业务代码按 `api / hooks /
components / pages / store / types` 严格分类；页面只做编排，业务逻辑落到 `hooks` 与
`api`。

## 1. 技术栈

| 领域 | 选型 |
| --- | --- |
| Framework | React 19、React Router 7 |
| Build | Vite 5、TypeScript 5 strict |
| UI | Ant Design 5、`@ant-design/icons` |
| Server state | TanStack Query 5 |
| Request | Axios，统一拦截器（401/403/404/500 文案、Toast/Notification） |
| Client state | Zustand（仅 `user`/`menu`/`theme`） |
| 日志/可视化 | `LogViewer`、`PipelineGraph` 静态预览；React Flow/WebSocket 预留 hook |

依赖固定在 [`frontend/package.json`](../frontend/package.json)；`package-lock.json`
由 `npm install` 生成。

## 2. 启动与构建

```bash
cd frontend
npm install                # 安装依赖（建议先执行 npm config set legacy-peer-deps true）
npm run dev                # 开发模式，端口 5173，自动代理 /api -> 8000
npm run typecheck          # 仅做类型检查
npm run lint               # ESLint (--max-warnings=0)
npm run build              # 类型检查 + Vite 生产构建
npm run preview            # 本地预览 dist
```

Vite 已配置 `/api` 代理到 `http://127.0.0.1:8000`（可通过 `VITE_API_TARGET` 覆盖），
所以 `npm run dev` 期间直接访问 `http://127.0.0.1:5173`，前端请求就会落到后端。

后端启动方式参考 [readme.md](../readme.md) 第 1 节；`docker-compose.yml` 不包含前端
服务，原因是生产部署场景下前端通常由 Nginx/Caddy 单独托管。

## 3. 目录

```text
frontend/
├── public/                # 静态资源
├── src/
│   ├── api/               # 与后端路由器一一对应，禁止在页面直接使用 axios
│   ├── assets/
│   ├── components/        # 通用组件（PageHeader/StatusTag/LogViewer/...）
│   ├── hooks/             # useApiQuery、useApiMutation、useDebounce...
│   ├── layouts/           # MainLayout
│   ├── pages/             # 9 个页面，全部 lazy()
│   ├── router/            # 路由表 + 菜单定义
│   ├── store/             # zustand: user/menu/theme
│   ├── styles/            # global.css、antd theme
│   ├── types/             # 与后端 Pydantic 模型对齐的 TS 类型
│   ├── utils/
│   ├── App.tsx
│   └── main.tsx
├── package.json
├── tsconfig.app.json
├── tsconfig.json
├── tsconfig.node.json
└── vite.config.ts
```

## 4. API 封装

`src/api/*.ts` 内的函数只返回 `Promise<T>`，不依赖 antd；统一错误处理由 `http.ts`
的拦截器负责。常用入口：

- `listPlugins / registerPlugin / uploadPlugin / deletePlugin / getPlugin`
- `listPipelines / createPipeline / getPipelineYaml`
- `submitRun / getRun / getTaskLog / downloadArtifactUrl`
- `listArtifacts`
- `dashboardSummary`

`ApiAntdBridge` 会在应用挂载时把 antd `message` 与 `notification` 注入到
`bindAntdApis`，因此页面调用任意 API 都会自动派发对应通知（404 走 `warning`、5xx
走 `notification.error`、其它走 `error`）。

## 5. 状态管理

- 远端数据：全部交给 TanStack Query，查询键集中在 `useApiQuery(['plugins'])` 这类
  一阶数组上；写入通过 `useApiMutation` 并配合 `invalidationKeys` 失效缓存。
- 本地状态：仅主题、侧边栏折叠、用户占位信息，落在 `store/{user,menu,theme}.ts` 的
  zustand store 中，并通过 `persist` 中间件写入 `localStorage`。

## 6. 组件约定

- 任何列表型页面必须使用 `<PageHeader>` + `<TableToolbar>` + `<Table>` + `<Pagination>`
  组合；Loading/Empty/Error 状态分别落到 `Loading`、`EmptyState`、`ErrorAlert`。
- 删除、注册、运行等不可逆动作必须经过 `confirmDanger` 或 antd `Modal.confirm`
  做二次确认。
- 所有业务异常通过 `useApiMutation` 的 wrapper 抛到 `message.error`，避免页面重复
  处理通知。
- 日志查看器 [`LogViewer`](../frontend/src/components/LogViewer.tsx) 支持关键字高亮、
  复制、下载、自动滚动；后续会切换到 `useLogStream`（已留 hook 接口）以支持 WebSocket。
- [`PipelineGraph`](../frontend/src/components/PipelineGraph.tsx) 现在是节点/边列表
  预览；它导出 `summarizeGraph` 保持稳定契约，未来 React Flow 渲染只换实现。

## 7. 路由

[`router/index.tsx`](../frontend/src/router/index.tsx) 使用
`createBrowserRouter` 并 `lazy()` 加载页面，统一由 `<Suspense>` 包裹
`<Loading rows={6} />`。菜单与路由同构在 [`router/menuItems.tsx`](../frontend/src/router/menuItems.tsx)
中，`MainLayout` 据此渲染 Sider。

## 8. 与后端的差异

- 前端只做 202/200/4xx/5xx 状态映射，错误信息优先读取后端 `detail` 字段。
- Run/Task 的"轮询日志"功能在 `TaskDetailPage` 中通过 `setInterval` 实现，未与后端
  WebSocket 接口耦合（后端尚未提供 WS 端点）。
- Pipeline YAML 编辑器目前是 `Input.TextArea`，未来引入 `@monaco-editor/react` 后只
  替换 `PipelineCreatePage` 的渲染。

## 9. 限制

- 尚未启用 React Flow DAG 可视化（仅留接口）。
- 尚未启用 WebSocket 实时日志（仅留 hook）。
- 鉴权、Setting 主题/地址切换是占位实现。
- 国际化、暗色主题切换尚未启用。
