# A.2.1 热土认证适配层：本地 Mock 交付

2026-11-16；分支 `feat/v2-minimal-mobile-ui`，基线 `c75c5e2435a6197923fda2751609c0fada77616a`。仅本地提交，不推送、部署或创建云资源。

## 实现范围与启用边界

首版只实现**已验证 PersonaVerse 用户主动绑定外部身份**，不提供外部身份直接登录、不自动注册、不合并邮箱，不改变本地邮箱密码或管理员认证。绑定不签发或替换本地 UserSession；原有聊天、收藏和费用关系继续使用内部 User ID。

默认关闭，未注入 Provider 时 start/finalize 返回 503 EXTERNAL_AUTH_DISABLED。Node 仅在 APP_ENV=test 且显式 PV_RENGINE_MOCK=1 时注入 Mock；本地 API Worker 仍强制隔离测试数据库，另需显式 RENGINE_MOCK=1。测试脚本为新测试场景显式启用，其他回归仍默认关闭。生产注入 Provider 直接拒绝启动，不能靠环境开关开放真实接口。

真实协议 adapter 使用注入 transport 的固定 HTTPS POST，实现安全登录令牌、授权码兑换、Token校验与资料获取；本轮仅使用合成响应测试它，**没有注册真实网络 Provider，没有读取或使用真实软件 Token**。生产接入仍需后续明确授权和协议验证。

## API、界面与安全

- GET /api/v1/auth/rengine：要求本地会话，返回启用状态和本人绑定白名单。
- POST /api/v1/auth/rengine/start：要求 verified User、当前会话 CSRF、Origin、受限流的当前密码确认；创建三分钟单次事务，返回模拟授权地址。相同会话重新发起使旧 pending 失效；exchanging 状态阻止再发起。
- POST /api/v1/auth/rengine/finalize：要求同一 User/Session/authVersion、CSRF、浏览器 HttpOnly Strict 绑定 Cookie及state；原子 pending→exchanging，在事务外调用 Provider，再事务内重新验证会话及期限、写入映射与 complete。失败进入 failed，不自动重试授权码；中断留下的 exchanging 到期后不可完成。
- 个人中心只在服务端返回 enabled 时显示 MOCK 绑定区；需要输入当前密码。中性 /auth/rengine/callback 不假定跨站首次 GET 有 Strict Cookie，同源请求重新验证本地会话；移除查询参数，采用 no-referrer 元数据，不接入第三方脚本。失败不显示成功。
- 32 随机字节 state 与浏览器绑定值，仅摘要持久化。上游 Token/授权码不入库；不信任客户端 userId、email 或成功标志。
- 校验 software_id、user_id/profile.id、UUID和期限；不使用邮箱作为关联键。外部资料不覆盖本地邮箱、资料或站长人格原文。
- 真实协议 transport 固定 api.rengine.top，禁跟随重定向，8秒请求信号与32KiB响应上限，验证 JSON和success。非JSON429、网络与解析异常失败关闭，公共响应不泄露上游正文。
- Mock 不调用 fetch；真实 adapter 的所有测试 transport 都是本地合成函数。原全局AI开关与预算默认关闭。

Workers Reply.header 对 Set-Cookie 改用 append，其余头仍为 set。成功结束绑定时同时清除独立 flow Cookie和预登录 Cookie；Node、真实 workerd、浏览器均检查两条头、实际删除行为和原本地会话仍有效。清除预登录 Cookie 不撤销主用户会话。

## 0008 迁移与数据完整性

新增 ExternalIdentity、ExternalAuthTransaction；User/UserSession增加反向关联，UserSession增加(userId,id)唯一索引支持复合外键。

- 外部主体和 UUID 各自在(provider,softwareId)作用域唯一；同用户同应用只允许一个绑定。
- 外键限制绑定必须指向真实 User；事务的(userId,sessionId)必须指向该用户自己的 UserSession。
- 身份字段与创建时间不可更新；状态只允许 active/disabled，disabled不可重新激活。未提供解绑/换绑/删除接口。
- 事务身份、摘要、期限不可更新；CHECK限制期限最多三分钟，状态只允许 pending/exchanging/complete/failed；触发器限制合法状态转换，终态不可重新激活。
- 同用户同身份重新授权可幂等绑定；跨用户、UUID漂移或其他唯一冲突拒绝，不重写记录。
- 可信应用服务负责用户授权，SQL约束不识别HTTP管理员身份；迁移账户与最小权限生产应用账户仍待独立验收。

0001—0007逐字保持不变。隔离 PostgreSQL全套重放0001—0008，Prisma/schema diff保持一致。原有账本复合外键、人格版本、聊天归属与隐私擦除约束不变。新用例比较绑定前后内部用户、聊天、收藏、账本数量；原有非空数据的聊天/收藏/费用回归也完整执行。

## 测试与构建

本轮独立执行，不继承A.2数量。包装与子测试不双计。一次额外Node用户浏览器补跑遗漏 PV_CHROMIUM_PATH，5项在浏览器启动前失败（默认缓存中无可执行文件）；恢复既有 /usr/bin/chromium 配置后重新执行，不删除测试或修改断言。

| 范围                          | 通过 | 最终失败 | TODO |
| ----------------------------- | ---: | -------: | ---: |
| Node单元/契约 pnpm test       |   42 |        0 |    3 |
| PostgreSQL pnpm test:database |  122 |        0 |    0 |
| Node原有公开浏览器            |   11 |        0 |    0 |
| Node管理员浏览器              |    5 |        0 |    0 |
| Node用户浏览器（含绑定）      |    5 |        0 |    0 |
| Workers API具体用例           |   33 |        0 |    0 |
| Workers管理员浏览器           |    5 |        0 |    0 |
| Workers用户浏览器             |    5 |        0 |    0 |

Node总计185；Workers具体用例43。test:workers的Vitest包装输出35通过：33 API及2个浏览器套件包装；浏览器子用例10项，不能再将包装与子用例累计。3个原有TODO：真实AI、生产HTTPS/真实Safari、加密备份完整恢复，不计通过。

新增覆盖：默认关闭/伪造身份/未验证账号、Origin/CSRF/密码确认、同用户重复绑定、跨用户冲突、Cookie缺失/重复/不匹配、state替换、并发回调一次派发、未知失败不重试、兑换期间撤销的事务回滚、数据库外键/不可变字段/终态、过期及多Cookie；保留20轮mock、跨设备恢复、删除、下架、账本不可变、管理员隔离回归。

环境：Node24、pnpm11、固定digest PostgreSQL16 tmpfs容器、Chromium和本地workerd。测试使用独立schema、随机本地账号与test.invalid邮箱，无真实用户资料。手机测试为浏览器移动视口，不表示真实iPhone验收。

复现：

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
pnpm format:check
pnpm db:test:stop
```

浏览器路径按本机调整；只有明确隔离的回环测试数据库被允许。服务启动和HTTP请求均不自动迁移。

## 真实接口验证前的准备与剩余风险

1. 轮换此前暴露的软件Token，通过服务端Secret配置，禁止发送到前端、仓库、日志或聊天。当前运行入口根本未配置真实Provider；本轮不读取任何真实Key。
2. 明确测试应用、预期software_id、固定HTTPS回调和测试账号；确认无收费调用后再授权真实验证。不得将生产账号或数据库用于测试。
3. 官方确认safeloginkey回调port的协议格式、回调白名单、授权码与应用/回调的绑定、PKCE能力、稳定subject/UUID及ID重用规则。
4. 确认远端Token撤销、统一退出与账号停用能力；当前没有自动同步远端撤销的承诺。后续外部登录/会话来源/解绑撤销必须单独实现测试，不能把本轮“绑定成功”当作SSO已完成。
5. Mock事务重放与并发测试不能证明上游授权码真正一次性、不会复用或始终绑定正确客户端；这些仍需真实授权验证。
6. 真实Workers出站、共享出口IP限流、HTTPS及Safari、生产最小权限、备份、日志查询参数脱敏、审计保留和清理任务仍待验证。中断exchanging记录只会失效，不包含后台恢复/清理调度。
7. 保留映射subject、UUID和认证事务是可关联的审计数据，不是完全匿名。账号软注销后不能登录或换绑，但映射保留治理仍需生产隐私政策。

官方依据：[登录URL](https://doc.rengine.top/#login-url)、[认证API](https://doc.rengine.top/#api-auth)、[OAuth兼容层](https://doc.rengine.top/#oauth)、[限流](https://doc.rengine.top/#api-overview)、[FAQ](https://doc.rengine.top/#faq)。本轮没有访问真实业务接口，也没有假设未记录的OIDC/撤销能力。

## 文件清单

共 21 个文件，全部在 v2/：

- `v2/apps/api/src/auth-providers/rengine.ts`
- `v2/apps/api/src/database-routes.ts`
- `v2/apps/api/src/external-auth.ts`
- `v2/apps/api/src/fetch-app.ts`
- `v2/apps/api/src/server.ts`
- `v2/apps/web/src/app/account/page.tsx`
- `v2/apps/web/src/app/auth/rengine/callback/page.tsx`
- `v2/apps/web/src/components/rengine-binding.tsx`
- `v2/cloudflare/api-worker.ts`
- `v2/database/migrations/0008_external_identities/migration.sql`
- `v2/database/schema.prisma`
- `v2/docs/phase-a2-1-status.md`
- `v2/scripts/cf-local.mjs`
- `v2/scripts/database-browser.ts`
- `v2/tests/database/external-auth.test.ts`
- `v2/tests/database/harness.ts`
- `v2/tests/e2e-users/accounts.spec.ts`
- `v2/tests/integration/rengine.test.ts`
- `v2/tests/workers/external-auth.test.ts`
- `v2/tests/workers/harness.ts`
- `v2/tests/workers/users-browser.test.ts`
