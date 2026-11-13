# Cloudflare 技术适配评估（PersonaVerse 2.0 / 3.1）

核查日期：2026-11-13。评估基线：`cfb3a649757ebe6fc13d4d25a2ff0245b7322e61` 的真实依赖与结构。本文是架构评估，不是 Cloudflare 部署验收。

本轮只读取公开官方资料并检查源码；没有登录 Cloudflare、创建资源、安装迁移适配器、上传密钥或执行任何发布命令。当前 Node/PostgreSQL 测试通过不等于 Workers/workerd 测试通过。

## 结论与建议

建议保留 PostgreSQL、原始人格内容、不可变版本、复合外键、CHECK、审计、事务和管理员认证规则。目标架构可以是 **Cloudflare Web Worker + 独立 API Worker + Hyperdrive + 托管 PostgreSQL**，但当前工程不能原样上传 Workers：默认 Prisma 原生引擎、Argon2 的 N-API 包和 Node 常驻服务入口是明确的改造点。

对于现有项目，优先做 **OpenNext 的小范围本地兼容性验证**，保留标准 `next build` 和现有页面；同时以 vinext 的兼容性检查作为备选研究。当前 Cloudflare 官方新项目指南已默认推荐 vinext，但它仍标注 beta；本项目优先验证 OpenNext 是降低既有工程变更面的选择，不是声称 Cloudflare 仍默认推荐 OpenNext。

禁止为了 Workers 适配改用弱密码哈希、删除 SQL 触发器、抹去版本历史、取消 CSRF 或丢弃审计。若密码哈希或事务兼容性验证失败，真实管理后台不能上线。先提交最小适配实验及结果，再决定迁移；本轮不做大规模重写。

## 1. 官方资料的可核查性

本次 `developers.cloudflare.com` 页面请求返回 HTTP 403，未将它当作文档内容或产品限制。随后成功读取 Cloudflare 官方 GitHub 仓库 `cloudflare/cloudflare-docs` 的公开源码，固定到提交：

- Cloudflare 文档：`111054bc9da509f5731ceafb202515c24267417a`，提交时间 2026-11-13T12:34:11Z。
- Cloudflare vinext：`f795c5637b04015a04e67369aaf79d0c6077dcbf`。
- OpenNext Cloudflare：`f5a2d09b239214f9c08afcc371bc6e1d0d98e1e5`。
- Prisma 官方 v6 归档文档：`2b15bdc77e6841f61d7d6a7e1adb04edad52a25d`。

下文的数字来自核查时的版本，不能将旧教程价格、未来套餐或账号后台的实际额度混为一谈。尤其：OpenNext 社区概览和 Prisma 部署文档仍有旧的 3/10 MiB 压缩大小描述；与本次较新的 Cloudflare 平台限制源码冲突时，采用 Cloudflare 平台源码，并将最终账号/工具链验证列为待办。

## 2. 工程依赖与兼容性矩阵

| 当前代码/依赖                                                     | 官方支持与真实障碍                                                                                            | 本轮结论                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Next.js `16.4.6`、React/React DOM `19.3.1`、App Router            | 两种适配路径均文档支持 SSR、RSC、路由、metadata；精确工程仍需跑 workerd                                       | 有可行路径，未实测 Workers                                          |
| `next build --webpack`，`experimental.useTypeScriptCli=false`     | OpenNext 改写标准构建输出；vinext 改为 Vite/RSC 工具链，不能假设现有构建专用配置直接生效                      | OpenNext 变更面较小；vinext 需单独验证                              |
| Fastify `5.12.8`                                                  | Workers 有 Node HTTP→fetch 官方桥接，但不是完整 Node 服务器                                                   | 需要独立 Workers 入口与依赖生命周期适配                             |
| Prisma/Client `6.19.3`，`prisma-client-js` 默认引擎               | 当前生成器没有 `engineType="client"`，默认原生查询引擎不能直接作为 Workers 原生插件运行                       | 改为无 Rust 引擎 + 同版本驱动适配器后验证                           |
| `@node-rs/argon2` `2.2.2`                                         | 当前安装包列出的可选依赖都是 OS/CPU 原生包，没有 Workers 目标；Node 兼容模式不等于能加载 N-API `.node` 动态库 | 现有哈希实现不能原样使用；需审核并测试 Argon2id WASM 路径           |
| PostgreSQL UUID、JSON、TEXT[]、Decimal、复合外键、PL/pgSQL 触发器 | Hyperdrive 连接的是 PostgreSQL 本身，可保留数据库端语义                                                       | 推荐保留 PG；真实托管库权限/扩展/事务仍需验证                       |
| Cookie、Origin、CSRF、会话撤销                                    | 基于 HTTP 与数据库的设计可保留；必须禁止认证查询缓存、避免跨用户状态复用                                      | 可适配，不能以框架迁移为由减弱保护                                  |
| Node 24 进程、`listen(127.0.0.1)`、SIGTERM、`.env.local`          | Worker 请求模型是 `fetch(request, env, ctx)`，不是操作系统端口和常驻进程                                      | 本地 Node 入口保留；另加 Workers 边界，不能直接调用当前 `server.ts` |

### Next.js、vinext 与 OpenNext

Cloudflare 的当前 Next.js 指南明确：vinext 为推荐默认路径，处于 beta；支持 App Router、SSR/streaming、RSC、Server Actions、middleware、route handlers、metadata 与大部分 `next/*`。其 README 列出 Cache Components/PPR、构建期图片/字体、部分原生包开发环境及新 API 的兼容缺口。[S1][S2]

本项目使用 `next/headers` 读取管理员 Cookie、服务端 `redirect`/`notFound`、metadata、动态 SSR、`next/link` 和 Next rewrite。这些都必须逐项验证，尤其未登录跳转、Cookie 往返、错误页、缓存与客户端导航，不能只验一个首页。

已读取官方源码包元数据：

- vinext 源码版本 `1.4.5`，Node `>=22`，peer 为 React/React DOM/`react-server-dom-webpack` `^19.3.1`、Vite `^8.0.0`。React 数字匹配本项目，但 App Router 需要额外 RSC 工具链，peer 满足并非行为通过。
- OpenNext Cloudflare 源码版本 `1.20.17`，Next peer 为 `>=15.5.29 <16 || >=16.4.5`，当前 `16.4.6` 位于范围内。官方文档支持 App Router/SSR/RSC/Route Handlers，OpenNext 社区说明 Next 16 minor/patch 受支持；迁移前仍应锁定实际发布包并核验 peer，而非盲装 latest。[S3][S4]

推荐先保留 Next.js、React、已有页面和构建，只增加候选适配层的独立实验脚本。若 vinext 后续在本项目的 workerd 安全回归中表现更好，可再决定替换构建；不能直接据“官方推荐”宣称 beta 与本工程完全兼容。

## 3. Fastify 与 Workers fetch 模型

当前 `apps/api/src/server.ts` 监听真实回环端口，`buildDatabaseApp()` 创建一个闭包持有的 PrismaClient，并在进程关闭时断开。照搬会导致入口、连接与请求生命周期不匹配。

较新的 Workers 官方 `node:http` 提供 `httpServerHandler`（`cloudflare:node`），可以将 `http.Server` 转成 Worker 的 fetch handler；`listen(port)` 的 port 是路由键，不是公开操作系统监听端口，也支持以 server 对象桥接。[S5]

因此 Fastify 5 **有值得验证的薄适配路线**，不应武断地说任何 Fastify 都不能运行 Workers，也不能因此说本工程已兼容：

1. 增加独立 fetch 入口，等待 Fastify ready，并通过官方 Node HTTP 桥处理请求；本地 Node 入口不变。
2. 使用请求作用域的数据库客户端/驱动；不可用一个跨请求 Prisma 连接闭包。验证 app-per-request 的 CPU 开销，或逐步将服务层与请求依赖解耦。
3. 测试多条 `Set-Cookie`、请求体、响应错误、长文本、403/401/503、断开/超时、并发事务和连接释放。不能只用 `fastify.inject()` 的 Node 测试代替 workerd。
4. Node HTTP 桥不支持直接 socket 访问，部分连接管理方法和 server options 不可用。当前 `req.ip`、`trustProxy=false`、`requestTimeout` 和关闭钩子要重新核实。持久化来源限流只能使用已建立可信边界的边缘来源信息，不能直接信任任意 `X-Forwarded-For`。
5. 若桥接不能稳定通过，保持原服务/鉴权/契约与 SQL，逐步抽取一个薄 fetch 路由边界；不要为了部署重写整个人格系统。

选择固定的 `compatibility_date`。当前官方文档说明 `2026-08-04` 及以后的日期默认启用 Node 兼容；较早日期需要显式相应 flags。HTTP server 方法在 `2025-09-01` 及以后随 Node 兼容可用。应以所选固定日期和锁定 workerd 版本验证，不仅检查是否写了 `nodejs_compat`。[S5][S6]

## 4. Prisma 6、托管 PostgreSQL 与 Hyperdrive

### 保持 Prisma 6 的最小候选路线

Prisma v6 官方归档明确：无 Rust 查询引擎路线从 `6.16.0` 起 GA；需要 `engineType="client"` 和 driver adapter，并给出 `@prisma/adapter-pg@6.19.3`。因此可以优先保留现有 `6.19.3`，不需要为 Cloudflare 直接升级至 Prisma 8。[S7]

候选改造是新的 Workers 生成配置（或另一个生成器输出目录）、`engineType="client"`、同版本 adapter-pg 和与 Workers 相容的 `pg`，连接串来自 Hyperdrive binding。Prisma v6 文档同时警告：无 Rust 路线充分测试的是 `prisma-client`，旧 `prisma-client-js` 应谨慎；应评估 `prisma-client` + 显式输出及 `runtime="workerd"`，再验证导入和生成代码，不在本轮直接改核心生成器。

当前 Cloudflare Hyperdrive 的 Prisma 示例已经采用 Prisma 8 的 `@prisma/orm-postgres`、contract API。它不是本项目 6.19.3 的直接替换代码。应使用对应 v6 官方说明，并保留版本锁定。[S8]

### 连接、事务与缓存

Hyperdrive 是连接池/加速层，**不提供 PostgreSQL 数据库本体**，必须另选托管 PG。候选提供商可为 Neon 等，但账号、地域、TLS、版本、权限、备份、费用和恢复目标须由站长之后单独批准。本轮没有创建或连接任何托管实例。

- 驱动客户端在 fetch 请求内创建，响应完成后按生命周期关闭；不要将请求中打开的 socket 跨请求复用。Hyperdrive 在网络层池化连接，不意味着现有全局 PrismaClient 自动安全。[S8]
- 同一事务内必须绑定同一连接，保留 Prisma 交互事务、CAS、`SELECT ... FOR UPDATE NOWAIT`、复合外键、CHECK、触发器和审计原子性。测试死锁/锁冲突、超时回滚、断线与错误码映射；不能把事务拆成多个无关联 HTTP 查询。
- 迁移仍用独立的受保护迁移连接在审批后执行，不通过 API 请求或 Worker 启动执行，也不由运行时账号拥有 DDL 权限。
- **初期建议关闭该 Hyperdrive 配置的查询缓存。** 官方默认 `max_age=60s`、`stale_while_revalidate=15s`。认证、权限、会话撤销、密码版本、额度、写后读取，以及要求下架立即生效的公开状态都必须读新值；HTTP `Cache-Control:no-store` 不会自动关闭数据库查询缓存。[S9]
- 若未来分离“可容忍延迟的公开目录”缓存，另建只读用途客户端/配置并设计发布失效；不能共用有缓存的认证客户端。关闭查询缓存仍可获得连接池收益。
- 当前 Hyperdrive 查询最长 60 秒，初始连接超时 15 秒；本项目的 10 秒事务与客户端上限仍需明确对齐，网络 abort 也不等于服务器上的 SQL 已即时取消。应在托管库增加合适的 statement/idle-transaction timeout，并验证失败释放锁。[S10]

## 5. Argon2id、Cookie 与 CSRF

### Argon2id 是上线阻断项

`@node-rs/argon2@2.2.2` 官方 npm 元数据列出的可选包均为 Darwin/Linux/Windows/Android/FreeBSD 的原生目标，没有 Workers 目标。当前 `.node` N-API 实现不能因启用 Node 兼容就认为可装载。[S11]

候选是经过审核的 Argon2id WebAssembly 实现，但本轮未选型、安装或基准测试。必须满足：

- 能验证现有 PHC 格式 `$argon2id$...` 哈希，不要求站长提交明文或批量重置密码。
- 与当前算法参数一致：memoryCost=19456 KiB、timeCost=2、parallelism=1；互相交叉验证 Node 生成/WASM 校验与 WASM 生成/Node 校验，覆盖 Unicode、空格、长密码和错误密码。
- 安全随机盐、版本/参数编码、拒绝畸形/过大参数哈希，以及 WASM 依赖和供应链审计。
- 实测 cold/warm CPU、内存与并发登录。128 MB 是整个 isolate 的共享上限，单次约 19 MiB 的算法内存还不含 SSR、Prisma 与其他请求；应限制同时哈希的数量，不能把该数当作最多可并发次数。
- Free 的 10 ms CPU 很可能不足以承担保持强度的 Argon2id 与 SSR；不能通过降低哈希强度“适配免费”。付费 Workers 的更高上限也不代替实际 CPU/DoS 测试。

若 WASM 路线不通过，先暂停管理后台上线。可另行评估 Cloudflare Containers 保留 Node/Fastify/原生 Argon2 的方案，但那是不同运行和计费模型，不属于免费 Worker；也需要新的资源审批与验证，不能当作已经完成的替代部署。

### Cookie 与 CSRF 规则保留

保留服务端会话、HttpOnly、生产 Secure、Host-only `__Host-` Cookie、精确配置的 Origin 和独立 CSRF token。3.1 对 SameSite 的最终选项以安全补丁及回归结果为准；选择 Strict 后必须测试从站外链接进入、同源登录确认、刷新、退出和改密，不因迁移默默改回宽松策略。

推荐同一个公开域名：`/` 和 `/admin/*` 由 Web Worker 提供，`/api/v1/*` 经 Service Binding 到 API Worker，API Worker不单独暴露公开开发入口。绑定调用必须正确保留 Cookie、Origin、CSRF header 与多个 Set-Cookie；可信 WEB_ORIGIN 仍是浏览器使用的域名，不能被内部 Worker URL 取代。SSR 向 API 查会话必须传当前请求的 Cookie，不能缓存或存进跨请求单例。

Secret binding 仅供服务端读取，不能放入 `NEXT_PUBLIC_*`、客户端包、日志或仓库。本轮没有绑定或上传 DeepSeek Key，也没有开放模型调用路径。

## 6. PostgreSQL 与 D1 的迁移代价

| 项目             | PostgreSQL + Hyperdrive                           | D1                                                                                |
| ---------------- | ------------------------------------------------- | --------------------------------------------------------------------------------- |
| 数据模型         | 保留现有 provider、UUID/JSON/数组/Decimal 及关系  | SQLite 方言与类型，需重新映射数组、UUID、时间、数值精度和 JSON 行为               |
| 原子保存与并发   | 可继续验证 PG 事务、行锁/CAS、`FOR UPDATE NOWAIT` | 官方提供原子 `batch()`，但不等同于当前交互事务与 PostgreSQL 行锁语义              |
| 不可变版本与审计 | PL/pgSQL 触发器及复合外键继续存在                 | 必须重写和验证 SQLite 触发器/CHECK/外键及恢复；不能删除这些保护                   |
| 大内核与历史     | TEXT 可保留原文，容量按托管库方案                 | D1 单字符串/BLOB/行最多 2,000,000 bytes；一个大内核+快照可能超过整行限制          |
| 迁移工具         | 既有 SQL 迁移链可复用；应做导入/恢复演练          | 原 PostgreSQL SQL 迁移不可直接应用，Prisma adapter、SQL、清理和备份流程都需新验收 |
| 计费             | Worker + 外部 PG 计算/存储/历史/网络              | Worker + D1 行读写/索引写放大/存储，可能便宜但不是兼容性替代品                    |

D1 是真正的可选数据库，不是 PostgreSQL 驱动切换。它有事务性 batch 和外键能力，不能笼统说“D1 没事务”；但这些不证明当前业务的交互事务、锁、不可变版本和精确数值可直接迁移。[S12][S13]

本项目优先保障作者原文、历史和权限，**不建议本轮或最小 Cloudflare 迁移改用 D1**。如未来另立 D1 方案，须提供全量历史迁移、双向校验、不可变保护、并发等价和恢复测试后再审批。

## 7. 套餐、资源与预计成本

以下为截至核查时公开资料，USD，未含税、域名、额外日志/对象存储/备份和真实 AI。没有保证某个账号一定符合免费额度。

### Workers 运行时与构建限制

| 项目                | Free                                    | Workers Paid                                                                    |
| ------------------- | --------------------------------------- | ------------------------------------------------------------------------------- |
| 动态 Worker 请求    | 100,000/日，UTC 日重置                  | 含 10,000,000/月，超出 $0.30/百万                                               |
| CPU                 | 10 ms/调用                              | 含 30,000,000 CPU ms/月，超出 $0.02/百万 CPU ms；HTTP 默认 30 秒，可配至 5 分钟 |
| 内存                | 128 MB/isolate                          | 128 MB/isolate                                                                  |
| Worker 程序体积     | 64 MiB，**未压缩 bundle**               | 同左                                                                            |
| 顶层启动执行        | 1 秒                                    | 1 秒                                                                            |
| 每请求同时对外连接  | 6                                       | 6                                                                               |
| 静态资产数量/单文件 | 20,000 / 25 MiB                         | 100,000 / 25 MiB                                                                |
| Workers Builds      | 3,000 分钟/月；并行 1；单次最多 20 分钟 | 6,000 分钟/月，之后 $0.005/分钟；并行 6；单次最多 20 分钟                       |

Workers Paid 最低 $5/月；标准静态资产请求免费且不限量。Service Binding 在 Standard 模型不额外收一次请求费，但两个 Worker 的 CPU 合计仍计费。数据库查询数也不能等同于网页请求数，一次登录/保存通常包含多条 SQL。[S14][S15][S16]

**64 MiB 的来源与口径：**官方源码 `workers/platform/limits.mdx` 第 266–284 行写 `Worker size (uncompressed)`；原句是 “There is no compressed size limit. Only the uncompressed bundle size counts.” 并说明 `Total Upload` 是未压缩大小，gzip 只作参考。这是程序 bundle 上限，**不是** 25 MiB 静态资产限制或构建机内存。可核查固定版本：[官方源码](https://github.com/cloudflare/cloudflare-docs/blob/111054bc9da509f5731ceafb202515c24267417a/src/content/docs/workers/platform/limits.mdx#L266-L284)。旧的 3/10 MiB 压缩数字不作为本次平台限额结论。

本轮没有生成 Workers bundle，故其实际体积、1 秒启动、CPU 和 WASM 内存均为待验证。常规 Next build 成功不能替代这些指标。

### Hyperdrive 与数据库

Hyperdrive 包含在 Free/Paid Workers 计划中；Free 为 100,000 数据库语句/日，Paid 文档列为不限查询数。SELECT/INSERT/UPDATE/DELETE/DDL 都算语句，不仅是读取。当前每配置到源数据库约 20 条（Free）/100 条（Paid）连接，分布式池在特殊情况下可能超过这个数量；不是严格的源库硬连接熔断器。最多配置 10（Free）/25（Paid）个数据库。[S10][S17]

Hyperdrive 不包含外部 PostgreSQL 的账单。作为可核实示例，Neon 官方价格页（页面标注更新于 2026-11-04）列出 Free：每项目 100 CU-hours/月、1 GB PG、5 GB 公网传输；超出计算或传输额度会暂停计算，不能据“免费”承诺持续可用。Launch 的计算为 $0.106/CU-hour、PG 存储 $0.35/GB-month；历史/备份/额外分支和网络另有项目。[S18]

D1 Free 为 500 万行读/日、10 万行写/日、总存储 5 GB，但**每个数据库最多 500 MB**；Paid 含 250 亿行读/月、5000 万行写/月、5 GB，之后分别 $0.001/百万行读、$1/百万行写、$0.75/GB-month，每库最大 10 GB。索引增加写入计量，未索引扫描会消耗大量行读；不是按返回行数计费。[S12][S19]

### 可复算预算场景

- **本地开发/兼容性研究：**本轮已有本地 PostgreSQL，Cloudflare 费用为 $0。没有购买、申请或开通云资源。
- **低流量付费 Worker + 符合条件的 PG Free：**Workers $5/月 + PG $0，约 $5/月起，前提是 PG/请求/CPU 都在额度内；可能因暂停、冷启动、备份窗口不足而不适合正式服务。
- **小型托管 PostgreSQL 示例：**假定 Launch 140 CU-hours/月、1 GB-month，PG 计算/基础存储约 `140×0.106 + 1×0.35 = $15.19`；加 Workers $5 为约 **$20.19/月**。这不是报价承诺，未含历史存储、额外网络、日志、域名和税。
- **动态流量增大示例：**假定 1,500 万动态请求/月、平均 7 ms CPU，Worker 为 `$5 + 5×0.30 + (105−30)×0.02 = $8/月`，另加 PG。Argon2 请求的 CPU 需单独实测，不能把 7 ms 套在登录上。

不建议把整个平台预算承诺为永久免费，也不应因免费套餐限制直接降低密码强度。费用预算、每调用 token/输出上限、全局熔断属于 DeepSeek 之前的应用级保护，Cloudflare CPU 上限不能替代模型费用控制。

## 8. 中国大陆访问与产品可用性

Cloudflare 官方说明：跨境访问会面临显著延迟与可靠性问题；China Network 是 Enterprise 的独立订阅，需要有效 ICP 等准入，并非普通 Free/Paid Workers 自动获得的大陆加速网络。[S20]

本次官方 China Network 可用产品表已经列出 Workers、Service Bindings 等能力，不能沿用“大陆网络完全不支持 Workers”的旧说法；但该列表没有证明目标组合的 Hyperdrive/托管 PG 能在大陆同等可用，必须另行向供应商确认。其文档也明确 Turnstile 不在中国大陆可用，不应把 Turnstile 作为当前认证唯一门槛。[S21]

未进行中国大陆三网、不同省份、移动 Safari、真实自定义域名、登录 Cookie、长连接或跨境 PG 延迟实测。不能保证 workers.dev 或自定义域名一定稳定可访问，也不能承诺 CDN 可以消除跨境数据库延迟。后续应按真实用户地区做多时段可达率、TLS、首字节、登录成功率、长文本与错误恢复测量，并在得到授权后单独选择可接受地域与方案。

## 9. 最小迁移验证计划（尚未执行）

本轮仅提交评估，下面是后续需单独批准的本地实验，不含任何远程发布步骤：

1. 在 `v2/` 内隔离的适配实验目录锁定候选版本，不覆盖现有 Node 构建或已执行 SQL 迁移；保存前后依赖差异。
2. 对现有 Web 跑 vinext 兼容性检查并记录差异；对 OpenNext 做本地 build/preview。优先选能保留当前认证 SSR 行为、变更最少且回归完整通过的路线。
3. 单独验证 Prisma 6.19.3 无 Rust 生成器、adapter-pg 同版本和 pg；只连接现有隔离本地 PostgreSQL。先覆盖所有原迁移、事务、约束、CAS、恢复和幂等测试，再谈 Hyperdrive 的实际托管验证。
4. 验证 Fastify→官方 Node HTTP bridge 的 Worker fetch 入口；若不行，先提交薄路由边界方案。保留错误码、权限、Origin、CSRF、审计与接口契约。
5. 选定并审核 Argon2id WASM 实现，执行 PHC 双向交叉验证与 CPU/内存/并发基准；不降低既有哈希参数。不通过则停在本地评估阶段。
6. 使用 workerd/本地 Workers 模式测试同域 Web→Service Binding→API 的 Cookie、CSRF、SSR 会话确认、Strict 行为、退出/改密撤销、DB 故障 503、客户端重试、20 轮、未保存发布保护及并发冲突。
7. 离线检查最终 bundle：不得包含 `.node`、原生 Prisma 引擎、数据库 URL、管理员密码、API Key 或客户端化的内核；记录未压缩程序体积、静态资产大小与启动 CPU。平台最终启动验证仍需后续授权，不能用本地模拟声称已验收线上。
8. 只有上述阻断项解决并提交可复现结果，才提出托管 PG/Hyperdrive 配置、域名、付费预算、备份恢复与逐步迁移方案，等待站长单独批准。本轮没有进行此步骤。

迁移后上线的必要前提还包括：生产数据库最小权限账户与迁移账户分离、完整备份恢复演练、禁用敏感查询缓存、请求限流和全站模型预算原子扣减、管理员测试预算、重复请求/未知结果不重复扣费、超时熔断与异常审计、密钥只在服务端、国内访问验证。未完成时不能接入收费模型或宣称已可生产上线。

## 官方证据索引

Cloudflare 文档站链接供人工阅读；本次实际读取的是其官方仓库固定提交源码。不要将文档中包含的“创建/登录/部署”示例当作本轮执行记录。

- **[S1]** [Cloudflare Next.js/vinext 指南源码](https://github.com/cloudflare/cloudflare-docs/blob/111054bc9da509f5731ceafb202515c24267417a/src/content/docs/workers/framework-guides/web-apps/nextjs.mdx) · [文档地址](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)
- **[S2]** [vinext 官方 README](https://github.com/cloudflare/vinext/blob/f795c5637b04015a04e67369aaf79d0c6077dcbf/README.md) · [源码包版本/peer](https://github.com/cloudflare/vinext/blob/f795c5637b04015a04e67369aaf79d0c6077dcbf/packages/vinext/package.json)
- **[S3]** [Cloudflare OpenNext 指南源码](https://github.com/cloudflare/cloudflare-docs/blob/111054bc9da509f5731ceafb202515c24267417a/src/content/docs/workers/framework-guides/web-apps/opennext.mdx)
- **[S4]** [OpenNext 官方概览](https://opennext.js.org/cloudflare) · [适配器源码版本/peer](https://github.com/opennextjs/opennextjs-cloudflare/blob/f5a2d09b239214f9c08afcc371bc6e1d0d98e1e5/packages/cloudflare/package.json)
- **[S5]** [Workers Node HTTP bridge 源码](https://github.com/cloudflare/cloudflare-docs/blob/111054bc9da509f5731ceafb202515c24267417a/src/content/docs/workers/runtime-apis/nodejs/http.mdx)
- **[S6]** [Workers Node 兼容与日期说明](https://github.com/cloudflare/cloudflare-docs/blob/111054bc9da509f5731ceafb202515c24267417a/src/content/docs/workers/runtime-apis/nodejs/index.mdx)
- **[S7]** [Prisma 官方 v6 无 Rust 引擎说明](https://github.com/prisma/docs/blob/2b15bdc77e6841f61d7d6a7e1adb04edad52a25d/apps/docs/content/docs/orm/v6/prisma-client/setup-and-configuration/no-rust-engine.mdx) · [v6 Cloudflare 指南](https://github.com/prisma/docs/blob/2b15bdc77e6841f61d7d6a7e1adb04edad52a25d/apps/docs/content/docs/orm/v6/prisma-client/deployment/edge/deploy-to-cloudflare.mdx)
- **[S8]** [Cloudflare Hyperdrive/Prisma 指南（当前为 Prisma 8 示例）](https://github.com/cloudflare/cloudflare-docs/blob/111054bc9da509f5731ceafb202515c24267417a/src/content/docs/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/prisma-orm.mdx)
- **[S9]** [Hyperdrive 查询缓存与敏感读取建议](https://github.com/cloudflare/cloudflare-docs/blob/111054bc9da509f5731ceafb202515c24267417a/src/content/docs/hyperdrive/concepts/query-caching.mdx)
- **[S10]** [Hyperdrive 连接/查询限制](https://github.com/cloudflare/cloudflare-docs/blob/111054bc9da509f5731ceafb202515c24267417a/src/content/docs/hyperdrive/platform/limits.mdx)
- **[S11]** [Argon2 2.2.2 官方 npm 元数据](https://registry.npmjs.org/@node-rs%2fargon2/2.2.2)
- **[S12]** [D1 限制](https://github.com/cloudflare/cloudflare-docs/blob/111054bc9da509f5731ceafb202515c24267417a/src/content/docs/d1/platform/limits.mdx)
- **[S13]** [D1 batch 事务语义](https://github.com/cloudflare/cloudflare-docs/blob/111054bc9da509f5731ceafb202515c24267417a/src/content/docs/d1/worker-api/d1-database.mdx)
- **[S14]** [Workers 价格](https://github.com/cloudflare/cloudflare-docs/blob/111054bc9da509f5731ceafb202515c24267417a/src/content/docs/workers/platform/pricing.mdx)
- **[S15]** [Workers 运行时限制](https://github.com/cloudflare/cloudflare-docs/blob/111054bc9da509f5731ceafb202515c24267417a/src/content/docs/workers/platform/limits.mdx)
- **[S16]** [Workers Builds 限额/价格](https://github.com/cloudflare/cloudflare-docs/blob/111054bc9da509f5731ceafb202515c24267417a/src/content/docs/workers/ci-cd/builds/limits-and-pricing.mdx)
- **[S17]** [Hyperdrive 计费表](https://github.com/cloudflare/cloudflare-docs/blob/111054bc9da509f5731ceafb202515c24267417a/src/content/partials/workers/hyperdrive_pricing.mdx)
- **[S18]** [Neon 官方价格页](https://neon.com/pricing)（核查时页面注明 2026-11-04 更新，价格和额度需在购买前复核）
- **[S19]** [D1 计费表](https://github.com/cloudflare/cloudflare-docs/blob/111054bc9da509f5731ceafb202515c24267417a/src/content/partials/workers/d1-pricing.mdx)
- **[S20]** [China Network 可用性与独立 Enterprise 订阅](https://github.com/cloudflare/cloudflare-docs/blob/111054bc9da509f5731ceafb202515c24267417a/src/content/docs/china-network/index.mdx)
- **[S21]** [China Network 产品范围与限制](https://github.com/cloudflare/cloudflare-docs/blob/111054bc9da509f5731ceafb202515c24267417a/src/content/docs/china-network/reference/available-products.mdx)
