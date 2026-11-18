# PersonaVerse 2.0 A.2 用户系统验收

日期：2026-11-15。分支 `feat/v2-minimal-mobile-ui`；本轮变更基线 `2ae3944b0c66e10815a5f6e89ef8030a7f4d45cc`。仅本地开发、隔离数据库和本地 Workers；不推送、不部署，不接入外部用户平台或真实 AI。

## 验收结论

本轮普通用户账号、个人聊天历史和收藏、本地模拟邮件、隐私删除及指定 Node/Workers 回归均通过。普通用户必须完成邮箱验证并登录，才能创建及继续新聊天；管理员认证、会话和私有聊天权限独立。回复仍明确标为 mock，不是 DeepSeek。

### 两个失败的真实原因

**跨设备历史显示：测试在路由跳转与记录加载之间过早取值。** 创建接口成功并 `router.replace('/history/<uuid>')` 后，新详情组件尚在读取记录，测试读到了界面占位符“尚未建立”，随后第二设备实际访问 `/history/尚未建立`，API 正确拒绝非法 UUID 并返回 400。数据库消息没有丢失。修正为等待路由 UUID 与服务端加载后的 `session-id` 完全一致再使用，不放宽 UUID 校验；浏览器用例主动延迟首次详情 GET 复现窗口，确认加载后发送成功，第二设备及刷新后仍能恢复同一 ID 和原消息。

**退出登录：确有双导航竞争。** UserBoundary 的焦点/恢复校验在服务器撤销会话后收到 401，跳转 `/login?next=/account`；当前页面也会收到自己新建 BroadcastChannel 发出的会话变化通知，覆盖退出流程期望的精确 `/login`。新增 `prepareUserSessionExit`：发请求前隐藏当前私人内容并标记当前文档退出中，在途复核和自身通知不再抢导航；确认服务器撤销后单一 `replace` 到指定目的地。失败时恢复服务器复核；其他标签页的撤销保护保留。测试在服务器已撤销而退出响应尚未返回时触发 focus，仍严格要求 `/login` 与旧会话 401；注销严格要求 `/login?closed=1`。没有改成宽松正则或跳过检查。

补充收藏页隐私回归：数据库模式的 `/favorites` 现在经过 SSR 登录验证，并沿用私人页面会话边界。收藏按钮在标签页隐藏、恢复和会话广播时清除旧状态并重新核验；同设备另一标签页退出后，原收藏页跳转登录且不再显示原账户内容。独立设备的另一有效会话保持可用。测试明确断言跨标签撤销后的 401 和私人 DOM 清除。

另修复本地邮件桥异常：非 ASCII Authorization 可以满足 JS 字符长度但不满足 Buffer 字节长度，使 timingSafeEqual 抛异常。现在仅接受固定长度 hex capability；回归先发送非法多字节凭据，再确认同一进程仍能私有投递，且没有 HTTP 读信接口。

## 实际测试与构建结果

| 命令/范围                | 环境                                 | 通过 | 最终失败 | TODO |
| ------------------------ | ------------------------------------ | ---: | -------: | ---: |
| `pnpm test`              | Node / Vitest                        |   37 |        0 |    3 |
| `pnpm test:database`     | 真实隔离 PostgreSQL，9 个文件        |  112 |        0 |    0 |
| `pnpm test:e2e`          | Node 显式 mock-regression / Chromium |   11 |        0 |    0 |
| `pnpm test:database:e2e` | Node / PostgreSQL / 后台浏览器       |    5 |        0 |    0 |
| `pnpm test:users:e2e`    | Node / PostgreSQL / 用户浏览器       |    4 |        0 |    0 |
| Workers API 用例         | 本地 workerd / PostgreSQL / 私有绑定 |   29 |        0 |    0 |
| Workers 后台浏览器       | 本地 workerd / Chromium              |    5 |        0 |    0 |
| Workers 用户浏览器       | 本地 workerd / Chromium              |    4 |        0 |    0 |

Node 合计 **169 通过、0 最终失败、3 原有 TODO**；Workers 单列 **38 个具体用例通过**。`pnpm test:workers` 的 Vitest 输出 **31 通过**，其中含 29 个 HTTP API 用例和两个执行浏览器子套件的包装用例；浏览器子套件共 9 项。本文将包装用例展开，不与子用例双计。没有继承上一阶段数字。

3 个原有 TODO 是真实 AI/生产 HTTPS 与真机/完整加密备份恢复等超出本轮的未来检查，不计为通过。类型检查（含 Web）、Workers 边界类型、格式、Fastify API 和 Next 构建、Prisma 生成，以及真正的 OpenNext 目标构建均通过。普通 `next build` 没有冒充 Workers 验证。

环境：Node 24.22.1、pnpm 11.25.0、官方固定 digest PostgreSQL 16.16、workerd 1.20261110.1、Chromium。本地数据库仅回环随机端口，随机凭据和 tmpfs；每套测试创建/迁移并清理独立 schema。浏览器中的“跨设备”是独立 Cookie/存储的 BrowserContext；手机以 390px 视口验证，不声称已做真实 iPhone Safari 验收。

### 迁移、权限和账本证据

- 原 0001—0006 逐字保持不变，只新增 `0007_user_accounts`；新库完整重放 0001—0007，旧匿名会话及站长原文保持不变，Prisma/schema diff 通过。
- User、UserSession、EmailVerification、PasswordReset、UserFavorite 独立关联。管理员/访客/普通用户会话必须恰有一个所有者，userId、persona/version 和创建幂等键不可改；普通用户不能认领旧匿名会话。
- 验证/重置只存摘要，单次消费、到期、authVersion、deliveredAt/usedAt/revokedAt 约束有效；退出、改密、重置、注销与事务内身份复核生效。
- 认证、猜测 sessionId、跨用户读/写/删/收藏、管理员冒用、并发创建/消息幂等、原始数据库断连和回滚都有实际用例。
- 下架后历史保留，禁止新消息；删除后用户 API 返回 404，消息物理清除、请求正文/响应不可恢复。费用事实、原所有者及固定版本保留。
- 新增费用验收：已经授权的 Fake 请求在聊天删除后仍能结算一次，消息数维持零、请求正文为空、响应为 SQL NULL，费用使用记录依旧不可更新。保留未知敞口规则，不用删除抹账。
- 原有 20 轮 mock、错误重试、刷新、收藏搜索、移动布局、管理员/访客身份隔离测试仍执行。旧匿名创建/发送仅在明确的 test 构造参数回归模式启用，产品默认关闭。

## 0007 与隐私保留设计

新增普通用户及会话、验证/重置摘要、个人收藏模型；ChatSession 增加 userId、creationKey、deletedAt、关联索引和三类 owner 恰选一约束。补充不可变身份、令牌单向状态和单向删除保护。

删除先关闭并 tombstone 会话，再在受限事务意图下仅擦除 ChatRequest.inputText/response、删除 ChatMessage。0007 不允许借隐私操作改变费用、指纹、人格版本或其他请求字段。保留数据是**假名化审计信息**，不是完全匿名，也不代表所有备份已擦除。完整权限/锁顺序、限流、邮件及保留边界见 [安全设计](user-accounts-security.md)。

注销要求会话、CSRF 和受限流的密码确认，撤销会话及票据、清空资料并替换邮箱、擦除个人聊天与收藏；原不变关联保留。极大账户可能超过 20 秒事务并整体失败，不能假报注销成功；生产需容量治理及可审计的分批擦除方案。

## 接口及页面

公开浏览保持免登录。新增 `/register`、`/login`、`/verify-email`、`/forgot-password`、`/reset-password`、`/account`、`/history`、`/history/[id]`；数据库模式 `/chat/[slug]` 登录后创建用户会话，收藏按账户保存。敏感页面禁索引，私人消息不写 localStorage；确认 Cookie 会话后才视为登录，非前端布尔假认证。

主要 API：

- `/api/v1/auth/csrf`、`register`、`verify`、`resend-verification`、`login`、`session`、`logout`、`forgot-password`、`reset-password`、`password`、`sessions` 及单会话撤销。
- `/api/v1/me` 查询/修改白名单资料，DELETE 确认注销。
- `/api/v1/me/chats` 分页列表/幂等创建，`/:id` 分页消息读取/删除，`/:id/messages` 幂等发送，`/:id/close` 关闭。
- `/api/v1/me/favorites` 分页列表，`/:slug` 查询、收藏及取消；只返回公开人格字段。
- 用户 `/:id/ai-requests` 经过身份与归属检查后明确拒绝 `AI_DISABLED`。真实 Provider 未接入。

## 本地重现与预览

```sh
cd v2
pnpm install --frozen-lockfile
pnpm db:test:start
pnpm db:generate
pnpm cf:client
pnpm typecheck
pnpm cf:typecheck
pnpm test
pnpm test:database
pnpm build
PV_CHROMIUM_PATH=/usr/bin/chromium pnpm test:e2e
PV_CHROMIUM_PATH=/usr/bin/chromium pnpm test:database:e2e
PV_CHROMIUM_PATH=/usr/bin/chromium pnpm test:users:e2e
pnpm cf:build
PV_CHROMIUM_PATH=/usr/bin/chromium pnpm test:workers
```

浏览器路径按本机安装调整。上述数据库测试仅接受 `.env.test.local` 的隔离回环库。测试邮件由私有 memory sink 或 0600 outbox 读取，不存在网页取信接口，不使用真实用户邮箱。

手动 Workers 预览先在隔离本地库执行显式 migrate，再 `pnpm cf:client && pnpm cf:build && pnpm cf:dev`；Web 回环 4320，API 经私有 Service Binding。模拟邮件写本地 `.local-mail/` 私有文件，用其中 fragment 链接完成验证；不发送真实邮件。Node 开发保留原开发文档：明确的本地配置、`PV_MODE=database`、`PV_LOCAL_MAIL=1` 时写 API 工作目录的私有 `.local-mail/`，或显式指定本地 `PV_LOCAL_MAIL_DIR`。没有默认管理员或默认用户密码。

## 剩余生产依赖及严格边界

生产邮件本轮统一 503，不伪造送达；本地请求 202 只表示受理，失败邮件的令牌不可用。正式邮件队列/投递、隐私保留时限和备份恢复、最小权限数据库账户、可信边缘 IP/反刷、真实 HTTPS/Safari、Hyperdrive 敏感查询无缓存及线上资源配额仍待单独授权验证。

本轮没有外部身份平台或真实 DeepSeek 连接，没有配置真实 Key。没有删除测试或放宽安全断言；确认的失败均有原因和对应回归。源码/测试/文档全部限定 v2/，不修改 main、备份、生产服务器或数据库。仅创建本地提交，不推送、不 PR、不合并、不部署。最终交付前停止本轮预览与隔离容器。

## 文件清单

共 59 个文件，全部位于 `v2/`。

- `v2/.gitignore`
- `v2/.prettierignore`
- `v2/apps/api/src/ai/engine.ts`
- `v2/apps/api/src/chat.ts`
- `v2/apps/api/src/database-routes.ts`
- `v2/apps/api/src/node-local-mail.ts`
- `v2/apps/api/src/server.ts`
- `v2/apps/api/src/user-auth.ts`
- `v2/apps/api/src/user-chats.ts`
- `v2/apps/api/src/user-mail.ts`
- `v2/apps/web/src/app/account/page.tsx`
- `v2/apps/web/src/app/chat/[slug]/page.tsx`
- `v2/apps/web/src/app/favorites/page.tsx`
- `v2/apps/web/src/app/forgot-password/page.tsx`
- `v2/apps/web/src/app/globals.css`
- `v2/apps/web/src/app/history/[id]/page.tsx`
- `v2/apps/web/src/app/history/page.tsx`
- `v2/apps/web/src/app/layout.tsx`
- `v2/apps/web/src/app/login/page.tsx`
- `v2/apps/web/src/app/page.tsx`
- `v2/apps/web/src/app/persona/[slug]/page.tsx`
- `v2/apps/web/src/app/register/page.tsx`
- `v2/apps/web/src/app/reset-password/page.tsx`
- `v2/apps/web/src/app/verify-email/page.tsx`
- `v2/apps/web/src/components/persona-card.tsx`
- `v2/apps/web/src/components/storage-ui.tsx`
- `v2/apps/web/src/components/user-account.tsx`
- `v2/apps/web/src/components/user-auth.tsx`
- `v2/apps/web/src/components/user-boundary.tsx`
- `v2/apps/web/src/components/user-chat.tsx`
- `v2/apps/web/src/components/user-favorites.tsx`
- `v2/apps/web/src/components/user-history.tsx`
- `v2/apps/web/src/lib/server-api.ts`
- `v2/cloudflare/api-worker.ts`
- `v2/cloudflare/local-mail-transport.ts`
- `v2/database/migrations/0007_user_accounts/migration.sql`
- `v2/database/schema.prisma`
- `v2/docs/phase-4a-2-status.md`
- `v2/docs/user-accounts-security.md`
- `v2/package.json`
- `v2/packages/api-client/src/index.ts`
- `v2/packages/api-client/src/user.ts`
- `v2/playwright.users.config.ts`
- `v2/playwright.workers-users.config.ts`
- `v2/scripts/cf-local.mjs`
- `v2/scripts/database-browser.ts`
- `v2/scripts/local-mail-bridge.mjs`
- `v2/scripts/validate-worker-local.mjs`
- `v2/tests/database/budget.test.ts`
- `v2/tests/database/harness.ts`
- `v2/tests/database/user-accounts.test.ts`
- `v2/tests/database/user-constraints.test.ts`
- `v2/tests/e2e-database/admin.spec.ts`
- `v2/tests/e2e-users/accounts.spec.ts`
- `v2/tests/integration/local-mail-bridge.test.ts`
- `v2/tests/workers/browser.test.ts`
- `v2/tests/workers/harness.ts`
- `v2/tests/workers/users-browser.test.ts`
- `v2/tests/workers/users.test.ts`
