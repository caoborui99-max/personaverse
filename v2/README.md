# PersonaVerse 2.0 · 数据库与站长工作空间

第三阶段实现 PostgreSQL 持久化、Argon2id 管理员认证、站长人格管理与不可变版本。**真实 AI 尚未接入**，聊天回复仍明确标记 mock。没有自动创建管理员、正式人格或部署。

## 本地启动（全新隔离 PostgreSQL）

要求 Node.js 24、pnpm 11.25.0、可使用的本机 Docker。所有服务只监听回环地址，不停止已有进程；4310/4311 若被占用须选择其他开发端口。

```sh
cd v2
pnpm install --frozen-lockfile
pnpm db:test:start
node --env-file=.env.test.local scripts/database.mjs migrate
pnpm db:generate
cp .env.test.local .env.local
pnpm admin:init
pnpm dev
```

`db:test:start` 生成随机密码和随机回环端口，写入权限 0600、Git 忽略的 `.env.test.local`。容器独立命名、带归属标签、使用临时内存卷；不会使用现有数据库或生产配置。

`admin:init` 要求交互式终端，打印不含凭据的环境与数据库名，并要求键入数据库名确认；邮箱由你输入，密码隐藏输入两次，至少 12 字符。没有默认密码，不接受密码命令行参数或环境密码；账户已存在会拒绝覆盖。管理员初始化不运行迁移，不创建人格。

浏览器：http://127.0.0.1:4310 。管理员：http://127.0.0.1:4310/admin/login 。公开目录初始为空。

停止应用后可执行 `pnpm db:test:stop`，**只移除带匹配归属标签的测试容器和生成的测试配置**，内存测试数据将丢失。如复制过 `.env.local`，该文件也要自行删除或重新从新生成的测试配置复制，避免连接已停止的旧端口。

独立开发库可另配 `.env.local`：APP_ENV=development、数据库名以 personaverse_v2_dev 开头、回环 PostgreSQL。测试使用 APP_ENV=test、personaverse_v2_test。生产要求显式确认和 HTTPS，本阶段无生产连接与操作；初始化和迁移工具拒绝生产环境。

## 验证

```sh
pnpm typecheck
pnpm test
pnpm test:database
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:database:e2e
pnpm format:check
```

浏览器测试需要先构建、保证 4310/4311 空闲。`test:e2e` 保留第二阶段全部 11 条测试，明确启动 PV_MODE=mock-regression；`test:database:e2e` 使用真实 PostgreSQL 的全新随机 schema、随机合成管理员密码，结束自动清理。两组浏览器测试不要并行运行。

已有系统 Chromium 时可加 `PV_CHROMIUM_PATH=/usr/bin/chromium`。数据库测试每次在独立 schema 重放真实迁移、验证并清理，不使用 SQLite，不对公共 schema 做清空操作。

显式检查迁移差异：

```sh
node --env-file=.env.test.local scripts/database.mjs validate
node --env-file=.env.test.local scripts/database.mjs diff
```

迁移永不在请求、服务启动或管理员初始化时自动执行。禁止用 db push 代替审查过的 SQL 迁移。

## 功能

站长后台：空白草稿、资料/标签/分类/HTTPS 头像引用、独立内核文本区、保存、版本历史、原文比较、恢复为新版本、明确发布与下架、安全归档、管理员指定版本模拟测试。保存有 revision 冲突检测，旧版本由数据库触发器保护。

公开目录和详情 SSR 查询已发布快照；草稿改动不会提前公开，API 不返回内核。收藏保存在设备，已下架人格不可再公开访问。匿名访客和管理员使用不同 Cookie、数据库实体与 API 命名空间。

详细说明：[架构](docs/architecture.md)、[认证](docs/authentication.md)、[模型](docs/data-model.md)、[API](docs/api-contract.md)、[OpenAPI](docs/openapi.json)、[本阶段验收](docs/phase-3-status.md)、[本阶段文件清单](docs/phase-3-files.md)。第二阶段记录保留于 phase-1-status.md。
