# PersonaVerse 2.0 第四阶段 A.1 本地交付

日期：2026-11-14。分支 `feat/v2-minimal-mobile-ui`。本地与远程开始基线均为 `a448da9bd8f32367c7d82d89175936f4fec498d9`，工作区初始干净。

## 结论

**本地 Workers 的动态路由与动态 WASM 两项阻断均已修复；本轮指定的本地业务集成路径通过。** 不等于 Cloudflare 线上环境、Hyperdrive、正式最低权限账号或免费 CPU 配额已验收。没有部署、创建云资源、调用收费模型、操作生产或推送。

## 实际变更

- 把原数据库应用的路由、全局 Origin/CSRF/管理员鉴权、Zod、业务服务、审计和错误处理原样抽出为 `registerDatabaseApp`。Node 保留 Fastify 入口；Workers 使用小型 fetch 传输适配器，未调用 find-my-way，不改整个业务系统。
- 适配器只实现现有 GET/POST/PUT/DELETE、请求/关闭 hook、reply/header/error/not-found。不是完整 Fastify：不支持插件或未来扩展时必须显式适配，不能默默跳过权限。输入保留原文，JSON 有 2.2MB 流式上限；拒绝编码静态路径绕过管理员前缀、重复查询绕过 Zod 等情况。不启用 eval。
- `hash-wasm` 4.13.0 的固定发行源码经 SHA-256 审查门禁，在构建期提取 Argon2/BLAKE2b 二进制，静态 import 为 WebAssembly.Module，仅替换动态 compile 装载点。无全局 monkey-patch，无算法重写。完整 MIT notice 随生成产物复制，并保存在仓库中。
- m=19456 KiB、t=2、p=1、32 字节输出不变；随机盐、PHC 参数白名单、单 isolate 同时最多两次内存哈希保留；繁忙返回 429，不能伪登录或弱化密码。
- PG adapter 的 schema 同时用于连接启动 `search_path`，避免原生 SQL/触发器错误查询 public；schema 仅允许 public 或本地随机 `pv_...` 名称，禁止注入。保留所有外键、触发器、事务和锁。
- 新增直接/嵌套 DriverAdapterError SQLSTATE 映射，包含 P2010 内的 NOWAIT 锁冲突，错误内容不暴露 SQL/敏感字段。连接/语句/查询超时显式配置；按请求创建客户端，用 `ctx.waitUntil(app.close())` 完成断开，避免断连清理阻塞失败响应。
- `/fail-once` 的 mock 重试标记改为隔离数据库中的短期计数行；原 per-app Set 在每请求新建 Workers app 时会反复首次失败。重试和重复提交已通过 Workers 验证。
- 授权到 Fake admission 间增加有锁复核，关闭/下架/熔断时取消未开始的执行；模拟发送开始后提交失败保留 unknown 预算。见 [竞态设计与实测](cloudflare-dispatch-safety.md)。真实 Provider 仍不存在，费用默认关闭，预算默认零。

0001—0006 全部原样保留，本轮没有新增 SQL 迁移。正式人格原文未生成、改写或覆盖；测试只写随机 disposable schema 内明确标记的测试内容，退出清理。

## 本轮实际验证

| 命令/套件                  | 环境                                            | 通过 | 失败 | 待完成 |
| -------------------------- | ----------------------------------------------- | ---: | ---: | -----: |
| `pnpm test`                | Node，含 PHC/传输与驱动契约                     |   35 |    0 | 3 TODO |
| `pnpm test:database`       | 真 PostgreSQL，含 5 项新派发竞态                |   76 |    0 |      0 |
| `pnpm test:e2e`            | Node mock-regression / Chromium                 |   11 |    0 |      0 |
| `pnpm test:database:e2e`   | Node / 独立 PG schema / Chromium                |    5 |    0 |      0 |
| Workers HTTP API 集成      | workerd / 私有 Service Binding / 独立 PG schema |   17 |    0 |      0 |
| Workers 原有后台浏览器套件 | workerd / 独立 PG schema / Chromium             |    5 |    0 |      0 |
| `pnpm cf:verify`           | 真实本地 workerd，重建 OpenNext 产物            |   10 |    0 |      0 |

Node 合计 127 通过、0 最终失败、3 原有 TODO。Workers 单列 32 项具体检查通过。`pnpm test:workers` 的 Vitest 输出为 18 项：17 个 API 用例加一个运行五项 Playwright 的包装用例；不能再把包装用例额外计入具体业务测试，本文没有双计。

TypeScript/Web/Workers 边界类型、格式、API/Next 构建和实际 OpenNext 目标构建均通过；PG 套件包含从干净 schema 重放 0001—0006 及 schema diff。执行环境：Node 24.22.1、pnpm 11.25.0、官方固定 digest PostgreSQL 16.16（tmpfs、随机凭据、仅回环）、本地 workerd 1.20261110.1、Chromium。不是线上 Cloudflare 数据。

### Workers 实际覆盖

- Web→API Service Binding、SSR 首页/广场/详情/聊天/登录/后台及未登录重定向。
- Node 生成的 Unicode、空格、256 字符 PHC 在 Workers 验证；Workers 改密 PHC 在 Node 验证；错误密码与恶意参数拒绝；并发登录资源保护。
- Strict/HttpOnly/Host-only 本地 Cookie；真实浏览器跨站导航不带 Cookie、同站恢复；Origin/CSRF、伪造身份、过期、退出/改密撤销及审计。
- 空白人格、长内核逐字保存、公开字段白名单、发布/下架/归档、并发编辑、历史恢复；未发布内容不可公开获取。
- 20 轮消息持久化、幂等、跨访客拒绝、归属修改拒绝、NOWAIT 并发、mock 重试、关闭/下架禁止新消息。
- 用 pg_terminate_backend 实际中断保存事务，HTTP 503、revision 与版本创建回滚；费用 API 默认 503 AI_DISABLED。

### 调试中的失败与修复

未沿用上阶段数字，也没有删除失败断言。初次完整运行暴露了：adapter schema 与 search_path 不一致；P2010 包裹的驱动错误被误报 503；同步等待断连清理使失败响应悬挂。三项均有修复后实测。

测试编排还发现共享登录 fixture 触发真实 IP 限流、Node/Workers Playwright 输出目录冲突、漏设本机 Chromium 路径，以及并发登录后用“第一条会话”错误地验证 Cookie。分别改为独立随机数据库 fixture、独立产物目录、显式浏览器路径和按 Cookie 摘要定位对应会话；没有关闭限流或放宽认证断言。临时诊断导致的一次类型构建错误已移除，最终构建重跑通过。诊断日志不进入提交。

## 可复现（全部本地）

```sh
cd v2
pnpm install --frozen-lockfile
pnpm db:test:start
pnpm cf:client
pnpm cf:build
PV_CHROMIUM_PATH=/usr/bin/chromium pnpm test:workers
pnpm test
pnpm test:database
pnpm build
PV_CHROMIUM_PATH=/usr/bin/chromium pnpm test:e2e
PV_CHROMIUM_PATH=/usr/bin/chromium pnpm test:database:e2e
# 手工预览的独立终端：
node --env-file=.env.test.local scripts/database.mjs migrate
pnpm cf:dev
# 另一终端：
pnpm cf:verify
```

浏览器路径按实际安装调整。cf:dev 自动执行固定源码的静态 WASM 生成；所有命令无远程发布入口。Workers 集成测试自行迁移随机 schema、创建随机测试管理员、启动私有本地 Worker，并清理 schema/进程/临时配置。默认 Node 开发入口保留。最终测试容器与预览进程在交付前停止。

## 尚未完成与上线边界

- 未登录 Cloudflare，未创建真实 Hyperdrive；敏感查询缓存禁用、托管 PG、最小权限应用账户、生产 HTTPS/Secure Cookie、真实地域网络和 CPU/内存/冷启动额度仍须单独授权验证。
- 本轮 fetch 入口只针对当前路由面，不能直接承诺完整 Fastify 插件兼容。IP 当前是本地 Service Binding 技术标识，未信任任意转发头；真实边缘客户端 IP 和防伪桥接需后续设计。
- 静态 WASM 仅改装载器，不等于第三方密码库已完成独立安全审计；升级源码/依赖必须重新审查和交叉验证，不能改 checksum 绕过审核。
- Fake admission 不是供应商接收凭证，真实 HTTP 与 DB 无原子提交，不能保证外部 exactly-once。unknown 保持预留；真实协议、价格/tokenizer、账单证据、恢复调度、告警和密钥管理尚待实现。
- 仍保留真实 AI 流式接入、生产真机及完整加密备份恢复三项原有 TODO。未自动进入第四阶段 B。

## 变更文件

共 27 个，全部位于 `v2/`：

- `v2/apps/api/src/ai/engine.ts`
- `v2/apps/api/src/chat.ts`
- `v2/apps/api/src/database-app.ts`
- `v2/apps/api/src/database-routes.ts`
- `v2/apps/api/src/driver-errors.ts`
- `v2/apps/api/src/fetch-app.ts`
- `v2/cloudflare/HASH-WASM-LICENSE`
- `v2/cloudflare/api-worker.ts`
- `v2/cloudflare/api/wrangler.jsonc`
- `v2/cloudflare/argon-wasm.ts`
- `v2/docs/ai-budget-design.md`
- `v2/docs/cloudflare-dispatch-safety.md`
- `v2/docs/cloudflare-local-validation.md`
- `v2/docs/phase-4a-1-status.md`
- `v2/docs/phase-4b-readiness.md`
- `v2/package.json`
- `v2/playwright.workers.config.ts`
- `v2/scripts/cf-local.mjs`
- `v2/scripts/generate-static-argon.mjs`
- `v2/scripts/validate-worker-local.mjs`
- `v2/tests/database/budget.test.ts`
- `v2/tests/e2e-database/admin.spec.ts`
- `v2/tests/integration/fetch-transport.test.ts`
- `v2/tests/workers/browser.test.ts`
- `v2/tests/workers/harness.ts`
- `v2/tests/workers/runtime.test.ts`
- `v2/vitest.workers.config.ts`
