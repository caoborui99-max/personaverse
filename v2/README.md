# PersonaVerse 2.0 · 基础工程

独立于旧版的本地开发工程。所有应用数据是明确标记的中性测试资料；没有真实 AI、数据库连接、管理员登录、支付或部署。

## 环境与安装

Node.js 24 LTS，pnpm 11.25.0。依赖精确固定，提交 pnpm-lock.yaml；依赖安装脚本仅允许 workspace 中的明确清单。

```sh
cd v2
pnpm install --frozen-lockfile
pnpm dev
```

公开页面：http://127.0.0.1:4310 。API 健康检查：http://127.0.0.1:4311/api/v1/health 。两个服务只监听 127.0.0.1，启动前确认这两个新开发端口空闲；若占用，不停止原进程。

页面：`/`、`/explore`、`/persona/test-a`、`/chat/test-a`、`/favorites`、`/admin/login`。`/admin` 服务端重定向到登录入口，不提供后台数据。

默认值直接可运行，无需 .env。`.env.example` 只作配置说明，不会自动载入。调整端口时同时设置 API_PORT、WEB_ORIGIN、API_INTERNAL_URL，并在 web 启动命令中显式调整 --port；不要指向旧服务或生产数据库。

## 构建与测试

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

已有系统 Chromium 时可使用 `PV_CHROMIUM_PATH=/usr/bin/chromium pnpm test:e2e`。浏览器测试自动启动、停止两个回环地址服务，需要先构建，端口必须空闲。开发服务与浏览器测试不要同时运行。

构建产物可分别启动：

```sh
pnpm --filter @pv/api start
# 另一终端
pnpm --filter @pv/web start
```

数据库模型可离线校验；以下仅给 Prisma 提供解析用示例 URL，不建立连接：

```sh
DATABASE_URL=postgresql://pv_test:local_only@127.0.0.1:5433/personaverse_v2_test pnpm db:validate
pnpm contracts:generate
```

本阶段不提供自动执行迁移的启动脚本，不要对生产运行 migrate/db push。正式数据库迁移与恢复验证尚未执行。

## 聊天验收

直接点击卡片「开始聊天」。支持 20 轮以上模拟回复、同一会话 ID、刷新恢复、人格独立会话、清除全部聊天、消息幂等。输入 `/fail-once` 后点击发送可触发一次 503；点击「重试消息」复用相同消息 ID，不重复保存。

模拟服务只在进程内保存数据，访客 Cookie 24 小时过期；服务重启后历史失效，界面提示并建立新会话。浏览器仅在 pv:v2:\* 命名空间保存会话快照、待重试消息和收藏；不读取或改写旧版收藏。清除按钮删除当前匿名会话的所有服务端演示记录和当前设备本地聊天，不清除收藏。

手机、平板、桌面均有布局；演示阶段 robots 禁止索引。公开资料正文由 Next.js 直接输出 HTML，为后续正式 SSR 收录提供基础。

## 文档

- [架构](docs/architecture.md)
- [数据库与版本](docs/data-model.md)
- [API 契约](docs/api-contract.md)、[生成的 OpenAPI](docs/openapi.json)
- [认证边界](docs/authentication.md)
- [聊天设计](docs/anonymous-chat.md)
- [测试与交付状态](docs/phase-1-status.md)
- [备份恢复规划](docs/backup-restore.md)
- [完整文件清单](docs/files.md)
