# Cloudflare 免费方案本地运行验收

日期：2026-11-16。开发分支 `feat/v2-minimal-mobile-ui`，开始时 HEAD `15ba04a057bda5f764e0eec29c268e014c52b28f`。本报告独立重跑测试，不沿用上一阶段统计。

**结论：本地 Workers 功能可用；完整网站在 Workers Free 上稳定运行的验收仍阻断。** 保留现有密码强度的 Argon2id 明显超过本机估算的免费 10ms CPU 门槛。没有创建云资源、登录 Cloudflare、部署、隧道、公网入口、真实邮件或模型调用。未修改作者正式人格内容。

## 1. 方案与真实依赖

| 部分     | 锁定版本/实现                                                      | 本轮结论                                                                                             |
| -------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Web      | Next.js 16.4.6、React 19.3.1、OpenNext 1.20.17                     | Node 构建和真实 OpenNext 构建成功；SSR、动态页面和静态资源在本地 workerd 实际运行                    |
| API      | Fastify 5.12.8；Workers 使用已有窄 fetch 入口                      | Node 保留 Fastify；Workers 复用 Zod、服务、权限、Cookie、CSRF、审计，不加载 find-my-way，不启用 eval |
| 数据库   | PostgreSQL 16、Prisma/adapter-pg 6.19.3、pg 8.23.1                 | 无 Rust 客户端和真实 PG 交互事务通过本地运行；没有改为 D1                                            |
| 认证     | node-rs/argon2 2.2.2；hash-wasm 4.13.0 静态 WASM                   | 两种 PHC 双向验证；m=19456KiB、t=2、p=1、32 字节输出不变；Workers CPU 免费适配未通过                 |
| 运行工具 | Node 24.22.1、pnpm 11.25.0、Wrangler 4.161.0、workerd 1.20261110.1 | 使用现有锁定依赖，没有升级框架或锁文件；另安装 Playwright Firefox 用于隔离证书信任测试               |
| vinext   | 未引入                                                             | 当前官方默认推荐，但仍 beta。本轮没有迁移或声称已验证；切换构建器不能消除密码计算成本                |

推荐保留 **Workers Web + 私有 API Service Binding + PostgreSQL** 的长期结构，Web 使用未来的 `workers.dev` 地址，API 不单独开放公网。Pages 的 `pages.dev` 适合纯静态导出；本项目需要 SSR、服务端会话和动态 API，不能直接静态导出而保留全部功能。

当前 `cloudflare/api-worker.ts` 仍明确限制回环测试数据库和本地 Origin；不是可直接发布的生产入口。后续须另审生产入口、数据库 Secret/Hyperdrive 绑定和环境隔离，不能仅把 `workers_dev` 改成 true。所有现有配置继续禁止公开 Worker 地址和预览 URL。

## 2. 本轮修复与运行证据

1. API 测试入口根据经过白名单校验的本地 HTTP/HTTPS Origin 选择 Cookie 安全策略；HTTPS 使用 `__Host-`、Secure、HttpOnly、Strict、Path=/，不设置 Domain。
2. 本地邮件桥和 API 使用同一精确 Origin；邮件只写随机私有测试目录，不发真实邮件，不提供验证码查询 HTTP 接口。
3. 修复 Wrangler 多 Worker HTTPS 热重载：CLI 的协议选项只作用于首个 Worker。原 API 配置默认 HTTP，在包配置变化导致重载后代理会改写 Origin，合法 POST 被拒绝。现在生成同目录、被 Git 忽略的 `.local-runtime.json`，同时固定 API 的 `dev.local_protocol` 和 Origin，保留原静态配置。
4. 新增真实热重载正反例：故意把测试 API 内部协议切成 HTTP，合法浏览器写入收到 `403 ORIGIN_REJECTED`；切回 HTTPS 后成功。没有放宽 Origin 或 CSRF。早期全量验证的两个失败均保留在本地日志，不删除测试；修复后重新执行。
5. 私有邮件夹移出 Playwright 会重置的 `test-results/`，避免并行套件清理输出时破坏模拟邮件。目录及临时 CA、密钥、NSS 浏览器配置均被忽略，并在对应测试关闭时清理。

HTTPS 使用 OpenSSL 生成的短期本地 CA，只导入一次性 Firefox NSS 配置；不修改系统/共享证书库，不使用 `ignoreHTTPSErrors` 或关闭 TLS 校验。Node 健康探针显式信任该 CA，校验 IP SAN。浏览器实际完成 Owner 登录/刷新/改密/退出、人格编辑发布/下架、原生注册/测试邮箱验证/登录/重置、Fake 聊天、刷新及独立设备历史和收藏。验证跨站 Strict Cookie 不发送、Origin/CSRF 拒绝攻击、过期跳转、身份隔离、AI 和热土默认关闭。

这是 Linux Firefox 的 390×844 视口及 Chromium 回归，**不是物理 iPhone Safari 通过**。本地 CA HTTPS 也不是 Cloudflare 公网证书、边缘代理或真实跨地域网络验收。

本地 Node 预览仍使用 `http://127.0.0.1:4310`，API 健康 `http://127.0.0.1:4311/api/v1/health`。Workers 测试使用 4320，测试结束停止并清理随机 schema；没有留下公网或持续运行的 HTTPS 测试服务。

## 3. 免费配额和 CPU 实测

以下来自本轮重新读取的官方资料；未来使用前需再核对，不把套餐文档当作本账号已开通资源。

| 项目           | Workers Free 当前文档                                       | 本项目证据/限制                                                                                                       |
| -------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| CPU            | 10ms/HTTP 请求；网络等待不计 CPU                            | Argon2id 本地估计明显超限；不能承诺注册、登录和改密稳定                                                               |
| 内存           | 128MB/isolate                                               | Argon 单次内存参数约19MiB、最多2并发；真实边缘峰值尚未验证，不能把整个 workerd RSS 当成 isolate 内存                  |
| 请求           | 100,000/日                                                  | SSR、API 和写请求需要 Worker；不是100,000用户。Service Binding 与多请求页面须按实际账单口径检查                       |
| 程序           | 未压缩64MiB；当前无压缩尺寸限制；启动1秒                    | 本地 Web JS 5,848,487 bytes；API JS+Prisma/Argon/BLAKE WASM 共3,539,068 bytes，均低于尺寸门槛。不是云端上传或启动计量 |
| 静态资源       | 免费、不限请求；Free 20,000文件，每文件25MiB                | 本次48文件，共1,205,402 bytes，最大241,738 bytes。动态路由不因此免费无限                                              |
| 子请求/连接    | Free每次50子请求、6并行外连                                 | PG连接池本地max=2；Hosted连接池、并发与限额仍需实测                                                                   |
| Workers Builds | Free每月3,000分钟；1并发；20分钟/构建；2vCPU/8GB RAM/20GB盘 | 本地构建通过，不代表云端有限资源构建已通过。没有连接Git仓库或触发自动构建                                             |
| Hyperdrive     | Free每天100,000 SQL语句，独立PG另计                         | 不是数据库本体；一次登录涉及多条SQL，不能换算成100,000次登录                                                          |

新增 `pnpm cf:bench:argon --require-free-cpu`：独立、无数据库/外部服务绑定的本地 workerd，安全随机盐、现有静态 WASM，预热后每个端点12样本。通过 Linux 每线程 `schedstat` CPU 增量求和，不用 Workers 中受限制的 `performance.now()` 冒充 CPU。另记 Node 侧墙钟；整个进程 CPU 包含本地 HTTP 开销，因此是估计而非 Cloudflare 精确计费。

本轮初次空闲测量 hash/verify CPU 中位数约100.55/97.68ms；最终空闲复测为 **95.950/96.179ms**，p95为104.821/104.456ms，健康检查中位数0.239ms。严格资源门禁返回退出码2，明确保留未通过结果。最终样本和统计见本地验收证据中的 `argon-cpu.json`。运行时不在本地强制执行云端10ms上限；没有观察或声称云端1102。整个进程 RSS/HWM 635,676KiB包含运行时开销，不能据此判定128MB isolate通过或失败。

功能通过不能抵消此资源阻断；不降低 Argon 参数，不把一次请求拆成多次来规避CPU限制，不改成明文/可逆密码，不让客户端承担密码验证。

## 4. 可行的费用选择

**全部动态服务稳定运行、密码强度不变、只用 Cloudflare Free：本轮没有得到可验证的可行结论。**

- 零新增托管订阅的临时演示：由站长提供可持续运行的独立本机/测试主机，运行现有 Node Web、Fastify 与专用 PostgreSQL。未来获准后可用 Cloudflare Quick Tunnel 的临时 `trycloudflare.com` 地址，或另审轻量 Workers 代理以提供 `workers.dev` 地址。密码计算保留在 Node。当前仅验证本地 Node，**没有启动隧道或代理**；机器、电力、网络、备份和更新由站长负责，Quick Tunnel 无SLA、重启变地址、最多200并行请求且不支持SSE，不是免费稳定生产托管。
- 受限免费云端测试候选：轻量 Worker/静态入口配合 Render Free Node 与 Neon Free PG。只可作为下一轮获准后的实验；Render空闲15分钟休眠、启动可约1分钟、750小时/月/工作区、无持久文件系统；不能把其30天到期的免费PG用于长期记录。冷启动会超过现有部分客户端超时，需要独立修复验证，不能宣称现成稳定方案。
- Neon当前Free为每项目100CUh/月、1GB存储、5GB公网出站，5分钟闲置缩容；配额耗尽可能暂停计算，存储达到上限可能拒绝写入。最低0.25CU连续运行30天约180CUh，超过100CUh，因此Free也不能保证持续在线。没有创建或连接Neon账户/实例。
- 若要求全部动态服务在Workers运行，当前现实候选是Workers Paid（官方最低$5/月）并另选PG/备份；只作成本说明，不购买、不启用、不承诺总费用仅$5。仍须实际边缘CPU/内存/负载验收。

中国大陆到 `workers.dev` / `pages.dev` 及跨境数据库的可达性、延迟和丢包均未测，普通免费方案不保证稳定访问。

## 5. 数据库、环境与权限

本轮使用归属标签匹配的本地 PostgreSQL 16 容器，随机回环端口、随机凭据、tmpfs；各数据库/API/浏览器套件使用随机隔离 schema，实际重放0001—0008。没有触碰生产库，也没有改写任何历史迁移。保留用户/管理员独立会话、跨用户隔离、会话归属不可变、发布快照和不可变费用审计。

Prisma官方当前默认文档是v7；本仓库使用v6.19.3，另核对v6文档：无Rust `engineType=client` 自6.16 GA，配合同版 adapter-pg。实际本地SQL验证优先于套用v7示例。

| 环境           | 要求                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 当前本地       | `.env.test.local`随机测试连接、APP_ENV=test；cf脚本只接受回环`personaverse_v2_test`；私有`.dev.vars`、临时API配置和邮件 capability不入Git               |
| 未来Web        | 单一HTTPS Origin；SSR通过私有Service Binding；没有`NEXT_PUBLIC_`数据库/密码/第三方Token                                                                 |
| 未来API        | 独立受审生产入口；严格Secure/HttpOnly/Strict/Host-only Cookie；精确Origin和CSRF；用户、Owner和Viewer身份分离                                            |
| 未来PG         | 专用V2托管实例、证书校验、应用最小权限账户与迁移账户分离；迁移只通过受控手动命令，不在请求或启动执行；备份和恢复演练                                    |
| Hyperdrive候选 | **整个配置禁用查询缓存**。默认缓存不因写入失效；HTTP no-store不能替代SQL缓存关闭。认证/撤销/发布下架/预算必须读新值；托管事务、锁、故障与连接池尚未验收 |
| 邮件           | 目前仅本地模拟，生产发送接口仍未配置。不能公开测试邮箱令牌读取机制；公网注册前另审真实免费邮件或受控封闭测试账户流程                                    |
| AI/热土        | 维持默认关闭、预算零；不需要或读取真实AI/Rengine密钥；独立套件仅显式Mock外部绑定，无真实请求                                                            |

## 6. 测试、命令与证据

以下全部为本轮实际结果。执行环境为Linux x86_64、Node24.22.1、pnpm11.25.0、PostgreSQL16、Chromium156.0.8078.79，以及Playwright1.65.0所下载的Firefox。下列命令均在`v2/`执行。新增HTTPS套件需要OpenSSL和NSS `certutil`；安装Firefox仅下载浏览器，不连接任何邮件/AI服务。

| 套件/检查                |    通过 | 最终失败 |  TODO | 证据范围                                                                                    |
| ------------------------ | ------: | -------: | ----: | ------------------------------------------------------------------------------------------- |
| Node契约与单元           |      44 |        0 |     3 | 包含PHC兼容、客户端错误恢复、禁用外部认证及安全跳转                                         |
| Node真实PG/API           |     123 |        0 |     0 | 0001—0008、Schema一致性、认证/CSRF/角色、归属/不可变版本、发布、并发、回滚、账本            |
| Node原公开浏览器         |      11 |        0 |     0 | 明确旧匿名Mock回归模式，不是当前公开产品允许匿名新建聊天                                    |
| Node管理员浏览器         |       5 |        0 |     0 | Owner内容生命周期、未保存保护、版本、跨站Cookie                                             |
| Node用户浏览器           |       5 |        0 |     0 | 原生注册/私有邮箱验证、跨设备历史、重置、删除；仅一例显式Mock第三方绑定                     |
| Node禁用第三方登录浏览器 |      10 |        0 |     0 | 原生用户和Owner、CSRF、错误跳转、过期/撤销、热土入口关闭                                    |
| Node常驻预览浏览器       |       7 |        0 |     0 | 实际20轮、API重启后恢复、Viewer拒绝、删除、隔离、布局及无未捕获JS错误                       |
| Workers API              |      33 |        0 |     0 | 17运行时+12用户+4显式Mock外部绑定，真实PG、故障、事务、20轮和身份隔离                       |
| Workers原浏览器          |      10 |        0 |     0 | 5管理员+5用户，Web→API绑定，非Node HTTP入口                                                 |
| Workers新HTTPS浏览器     |       7 |        0 |     0 | CA证书校验、协议重载正反例、Secure Cookie、注册/登录、跨设备历史/收藏、重置/改密/退出、过期 |
| **功能用例合计**         | **255** |    **0** | **3** | Node205+Workers50；Workers外层42项含2个各运行5例的浏览器包装，展开后50，未重复加包装数量    |
| **独立Free CPU资源门禁** |   **0** |    **1** | **0** | exit2，hash/verify均明显高于10ms；不是功能回归通过                                          |

原有3个TODO未删除：真实DeepSeek流/计费集成、生产HTTPS代理与物理iPhone、加密备份完整恢复。另有部署验收尚未运行：真实Cloudflare资源限额/启动/负载、Hyperdrive及托管PG最小权限/TLS/缓存、真实邮件、跨地域与中国大陆访问。这些不计成已执行自动化用例，也不混入255通过。

格式、TypeScript（API/共享/Web及Workers）、Fastify/Next构建、OpenNext目标构建均成功。独立干净schema又重放全部8迁移并执行`diff --exit-code`，要求退出0和无差异后才计为一致；schema验证成功。数据库/API/browser套件均有各自的实际迁移证据。

运行中曾因磁盘满导致类型检查无法启动、HTTPS初始化5项跳过；清理本任务下载缓存后重新执行通过，没有删除源码或数据库。首次手工diff误用未迁移的默认public schema，正确返回差异；后改为独立随机schema完成真实迁移后重验无差异。协议重载修复前的完整Workers结果为39通过/2失败（外层统计），修复后完整重跑42通过/0失败。上述诊断失败不冒充最终通过，也不删除原有测试。

脱敏证据导出到`/workspace/artifacts/personaverse-cloudflare-free/`：`https-mobile-favorites.png`、`argon-cpu.json`、`bundles.json`和`validation-results.json`。原始日志仅保留在被忽略的`.local-preview/cloudflare-validation/`；其中可复核构建、数据库、Node浏览器及`workers-final.log`，不得直接批量上传私有邮件、证书或浏览器资料。

```sh
pnpm db:test:start
pnpm db:generate
pnpm cf:client
pnpm typecheck
pnpm cf:typecheck
pnpm test
pnpm test:database
node --env-file=.env.test.local scripts/database.mjs validate
node --env-file=.env.test.local scripts/database.mjs diff
pnpm build
pnpm cf:build
pnpm exec playwright install firefox
pnpm test:workers
# 下列Node套件共用4310/4311，先停止本项目持有的预览，逐一执行。
pnpm preview:stop
pnpm test:e2e
pnpm test:database:e2e
pnpm test:users:e2e
pnpm test:login:e2e
pnpm preview:start
pnpm test:runtime:e2e
pnpm format:check
# 独立资源门禁：本机明确不符合Free CPU时退出2，不是功能套件失败。
pnpm cf:bench:argon --require-free-cpu
```

运行中的本地Node预览与其私有测试资料保留；`preview:status`只显示无凭据的地址和健康。HTTPS验收输出截图、CPU统计和bundle统计可以脱敏交付；不交付原始邮件、存储状态、Cookie、证书私钥、数据库URL或未审查的trace。

## 7. Git与自动部署检查

A.2 `c75c5e2`、A.2.1 `efb138a`、运行验收 `e2c6487` 和登录修复 `15ba04a` 均为当前分支祖先。远程只读读取：开发分支仍为`2ae3944b0c66e10815a5f6e89ef8030a7f4d45cc`；main为`317a99f8510514d8b094b1630293e52db7cecb91`；备份为`8bd91fc04ae7b3eab2f82040c176ea209fe46130`。没有推送或移动这些分支。

检查待推送历史的101个v2文本blob、敏感文件历史路径、当前197个已跟踪文本文件以及本轮改动，不发现真实密钥、生产连接串、Cookie密钥或数据库文件。一个静态softwareToken字面量命中来自注入Mock transport的测试fixture（非有效64位官方Token）；另一个数据库URL命中为本地测试启动器的`${password}`随机变量模板，均不是实际凭据。不使用聊天中曾暴露的Token。环境文件、数据库/私有状态和测试CA均未跟踪。启发式扫描不是数学上的无泄密保证，审核后推送前仍须重查差异和远程SHA。

只读GitHub结果：Pages为legacy指定分支`preview/static-mobile-v01`的`/docs`，不是当前开发分支；可见最近部署为该分支的github-pages环境、SHA`1297c8889c0988303c89d917c70ffb5e92f7da02`。开发分支Actions运行列表为空。可见Actions索引有两个历史验证工作流和Pages系统工作流；两个历史YAML在当前main读取404，本地当前分支也没有`.github/workflows`，不能把索引中active元数据等同于可检查到当前触发规则。Webhook接口403，**无法排除不可见外部钩子或Cloudflare/Git应用集成**。没有修改设置或触发工作流；本轮不授权自动推送。

## 8. 下一步需站长处理

现在不需要进行Cloudflare账号操作。先审核CPU门禁并选择：保留强密码的独立Node测试源站零订阅演示，或批准研究付费Workers。尚不具备宣称完整免费公网测试站稳定可用的条件。

下一轮在明确批准后，才可配置免费子域、专用测试PG与角色/备份、禁用Hyperdrive缓存、单一HTTPS Origin和私有API绑定、Secret及受控邮件；保持自动部署关闭。随后实际验证公网证书/CPU/内存/冷启动/重启、数据库故障、物理iPhone Safari和国内网络。不得把本地测试入口、CA或模拟邮件管理能力直接开放公网。仍不进入真实DeepSeek接入。

## 9. 本轮文件清单

全部12个文件都在`v2/`；没有锁文件、数据库模型或迁移变更。新提交SHA由提交后的交付消息提供，避免在提交中自引用。

- `.gitignore`：忽略运行时API本地配置。
- `README.md`：实际免费限制和复测入口。
- `cloudflare/api-worker.ts`：本地Origin白名单、HTTPS Cookie选择和无敏感信息的重载探针。
- `cloudflare/argon-benchmark.ts`：不接数据库或外部服务的本地密码CPU探针。
- `package.json`：新增CPU测量命令，无依赖升级。
- `scripts/cf-local.mjs`：本地TLS参数、同源邮件、API协议固定与退出清理。
- `scripts/benchmark-worker-argon.mjs`：固定workerd、每线程CPU测量和严格Free门禁。
- `tests/workers/harness.ts`：私有CA、证书校验、隔离邮件和可观测的真实配置重载。
- `tests/workers/local-tls.ts`：一次性CA/证书/Firefox NSS配置。
- `tests/workers/https-browser.test.ts`：7项实际HTTPS浏览器验收。
- `docs/cloudflare-local-validation.md`：历史报告入口指向最新证据。
- `docs/cloudflare-free-readiness.md`：本报告。

## 10. 本轮官方资料

均于2026-11-16读取；不执行文档中的账号初始化、部署或资源创建命令。

1. [Workers限制](https://developers.cloudflare.com/workers/platform/limits/)：CPU、内存、请求、连接、程序与启动限制。
2. [Workers定价](https://developers.cloudflare.com/workers/platform/pricing/)及[静态资源计费](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)：动态/静态请求与Paid最低费用。
3. [Workers Builds限制](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/)：构建配额与资源，不等同本地构建。
4. [Pages Next.js](https://developers.cloudflare.com/pages/framework-guides/nextjs/)、[Workers Next.js](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)、[OpenNext](https://opennext.js.org/cloudflare/get-started)：Pages静态定位、vinext beta、现有OpenNext路径。
5. [Prisma v6 Cloudflare](https://www.prisma.io/docs/orm/v6/prisma-client/deployment/edge/deploy-to-cloudflare)：区分本项目v6与当前默认v7示例。
6. [Hyperdrive定价](https://developers.cloudflare.com/hyperdrive/platform/pricing/)、[限制](https://developers.cloudflare.com/hyperdrive/platform/limits/)、[查询缓存](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/)：连接池不提供PG本体、默认缓存及语句配额。
7. [Workers CPU诊断](https://developers.cloudflare.com/workers/observability/dev-tools/cpu-usage/)：墙钟与CPU不同，本地测量不能替代边缘计量。
8. [Neon定价](https://neon.com/pricing)、[Render Free](https://render.com/docs/free)、[Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)：零订阅候选的配额、休眠与演示限制，不是已获授权的实际接入。
