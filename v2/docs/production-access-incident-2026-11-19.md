# 2026-11-19 生产访问故障排查与修复候选

基线：main，d0d2b6541fb406cde7c7db16c7e4e42df2779ffa（PR #11）。修改在独立worktree/修复分支，保留原工作区未提交的部署准备文件。本次不部署、不自动合并、不读取密钥、不连接Neon、不修改生产数据或结构、不启用AI。

## 现场证据与确认范围

从当前环境对公开网站执行普通GET：

- `https://pv-web-production.caoborui99.workers.dev/` 返回HTTP 500。
- `/api/v1/personas` 返回HTTP 503，正文为 `{"error":{"code":"PRODUCTION_UNAVAILABLE","retryable":true}}`。
- GitHub部署运行元数据表明d0d2b65的生产部署工作流已成功完成；这只能证明工作流完成，不能证明具体请求成功或运行时配置正确。
- 没有Cloudflare运行日志、实时部署版本/绑定清单或Hyperdrive/Neon运行证据访问渠道。因此**尚未确认API持续503的生产根因**；不得把数据库权限、连接、缓存或Secret不一致猜测成已确认原因。已看到的503包络属于生产API入口的错误响应，不能仅据此定位哪个阶段失败。

## 已确认并修复的问题

1. 首页直接await公开列表，失败会让整个Server Component抛错；人格广场把列表和分类放在同一个Promise.all中，任一故障都会中断页面。现在首页保留导航/介绍/预置演示，明确展示“人格列表暂时无法加载”和重新加载入口；广场分类失败时保留真实列表，列表失败时明确显示故障。成功空列表仍显示“尚未发布”，故障不伪装为空库，不生成假人格。浏览器已验证恢复后重新加载真实合成fixture列表。
2. 生产gateway在try中直接return绑定Promise，没有await；Service Binding异步拒绝绕过catch。新增回归在原始main上因synthetic binding failure失败，修复后返回受控503而非未处理500。原有421来源拒绝、403伪造内部头拒绝及私有HMAC校验保留。
3. API transport内部把数据库错误转换为503响应时不会throw，原外层catch不会记录诊断。现在对>=500响应补充固定serve_api/status日志；将请求origin与缓存确认分成不同阶段，补充注册阶段和签名拒绝日志。不记录请求URL、IP、SQL、正文、连接串、异常message/stack或Secret。
4. PR #11的去端口行为保留，并提取到实际SSR使用的privateApiRequest。先以精确HTTPS origin建立URL，再赋path/search，随后签名；测试确保从127.0.0.1:4311、localhost:4311及旧HTTPS :4311出发都不会把端口带到生产，保留query/cookie，验证实际HMAC并拒绝篡改。另在真正的本地workerd双Worker Service Binding中执行该SSR签名模块，确认绑定接收的URL无开发端口且篡改查询返回403。不能把这些本地证据当成已经看到生产请求URL。

## 链路审查

- Web wrapper：生产gateway在OpenNext之前处理API请求，通过私有API Service Binding转发；SSR从Cloudflare context读取API、WEB_ORIGIN和BRIDGE_SECRET。Node本地API地址不直接作为生产签名URL。
- API：严格检查固定HTTPS origin、实际请求origin、缓存关闭声明、bridge proof、Hyperdrive声明的数据库/角色和实际SQL最小权限；没有通过关闭任何门禁来恢复页面。
- Prisma：API部署alias指向生成的workerd无Rust客户端并使用PrismaPg；本地generate/typecheck/build及生产dry-run覆盖产物。使用真正的生产入口注册/transport做合成适配器测试；该测试不等于真实Hyperdrive连接。
- SQL：另建随机命名回环测试数据库重放迁移，并以独立NOLOGIN测试角色验证真实production-role SQL检查。正常最小权限通过，预算上限UPDATE和DDL被拒绝；额外授予预算修改权限后预检拒绝。没有使用neondb或personaverse_app生产身份做测试。
- 配置/发布：API/password仍为私有，Web绑定pv-api-production，AI_ENABLED保持false。生产域名/发件地址在手动workflow中替换；部署脚本仍需人工确认、环境保护和Secret，不会由本PR自动触发部署。工作流成功不等于Secret、绑定、Hyperdrive远程禁缓存、Neon角色/迁移状态已获验证。

## 实际验证

在v2/执行（数据库为本轮创建的回环隔离PostgreSQL）：

| 命令                                                                                               | 最终结果                                                 |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| pnpm install --frozen-lockfile                                                                     | 通过，锁文件未改                                         |
| pnpm db:generate / pnpm cf:client / pnpm cf:wasm                                                   | 通过                                                     |
| pnpm typecheck / pnpm cf:typecheck                                                                 | 通过                                                     |
| pnpm test                                                                                          | 96通过、3原有TODO（不计通过）                            |
| pnpm db:test:start && pnpm test:database                                                           | 148通过，含本次真实PG角色预检用例                        |
| pnpm build                                                                                         | API + Next构建通过                                       |
| PV_CHROMIUM_PATH=/usr/bin/chromium pnpm exec playwright test --config playwright.catalog.config.ts | 4通过：主页故障/恢复、广场故障、分类独立故障、成功空目录 |
| pnpm cf:build                                                                                      | OpenNext目标构建通过                                     |
| node scripts/production-dry-run.mjs                                                                | password/API/Web本地打包通过，无上传                     |
| pnpm format:check / git diff --check                                                               | 通过                                                     |

首次浏览器运行把Next自身的route-announcer alert也计入业务告警，3个断言失败；改为main内的业务告警定位后完整重跑4项通过，没有删除故障/恢复断言。原main的gateway故障回归失败是确认实现缺陷的证据，不计为最终通过。新增测试都使用合成上游/密钥，本次未运行真实DeepSeek或热土。

## 尚缺的生产证据与最少操作

用户只需先提供一条失败请求对应的`PERSONAVERSE_API_FAILURE`固定字段：stage、errorClass，若新版本已有reason/status也可提供。不要发送完整日志、请求头、连接串或任何Secret。

阶段与下一步的关系（都是待证实的排查方向）：

| stage                                     | 需要核实的运行信息                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------------- |
| validate_origin / validate_request_origin | Web/API精确WEB_ORIGIN是否一致，实际绑定请求是否仍有:4311，部署版本是否为获准版本 |
| validate_cache                            | Hyperdrive实际禁缓存及API声明；不能仅把声明改true                                |
| verify_bridge                             | 两个Worker的Secret名称/版本是否一致；只在控制台核对/重新配置，不导出值           |
| validate_hyperdrive                       | HYPERDRIVE绑定是否存在，数据库/用户名与声明是否一致                              |
| initialize_database / register_routes     | 生成客户端、adapter和对应Worker版本/配置                                         |
| check_database_role                       | 由运营者核对连接、迁移完整性和实际最小权限；本轮不连接生产库做验证               |
| serve_api                                 | 结合固定状态字段定位路由读取故障，禁止公开SQL或连接详情                          |

代码审查后由用户自行决定合并和通过已有受保护workflow发布Web/API同一版本。本PR不自动合并、不触发生产部署，不要求普通网站访客接触GitHub或Cloudflare。生产API的503仍需日志定位；只部署页面降级修复能恢复可读框架，不能保证人格列表已经恢复。

## 上线前验收清单

- [ ] PR人工审查；确认无安全门禁被绕过，AI_ENABLED仍false。
- [ ] 获取上述安全日志字段，确认并处理实际API 503阶段。
- [ ] 用户授权后发布同一审核版本的Web/API；确认生成产物、Service Binding和对应runtime vars，Secret只留控制台。
- [ ] 普通浏览器/手机直接打开首页、人格广场，列表成功200并展示真实已发布人格；无:4311、无403/421/500/503，无前端未捕获错误。
- [ ] 分类、搜索、详情可用；未发布人格和私人记录仍不可越权访问。
- [ ] 模拟故障仅在隔离环境完成；生产不故意断库、不改预算/权限做破坏性测试。
- [ ] 网站访客无需登录GitHub/Cloudflare；生产恢复需以真实浏览器请求和API成功证据确认，不能只看build通过。
