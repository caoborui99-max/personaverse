# 封闭公网 Mock 测试适配补丁

本轮只在本机隔离 PostgreSQL/workerd 验证，没有创建远程资源、推送或部署。基线为 663a6f2b29fcfaf85696ad41dc14fec88a5de5be。

## 入口与信任边界

独立配置在 `cloudflare/mock-preview/`。Web 为唯一 workers.dev 入口；API/password 的 workers_dev、preview_urls 均 false，没有 routes。原本的 local-only Origin/数据库白名单保持不变。新入口没有诊断/邮件桥接/密码探针代码，Web 拒绝 `/__local*` 及编码变体，API 只处理 `/api/v1/`。

Web 在真实 Cloudflare ingress 读取平台覆盖的 CF-Connecting-IP，忽略并删除 Forwarded/X-Forwarded-For/X-Real-IP；客户端提交内部 x-pv-\* 头直接403。私有请求使用共享高熵 BRIDGE_SECRET 对 method、完整URL、IP、时间签名，API 校验签名及10秒窗口。签名不是用户认证或CSRF替代，也不是持久化重放保护；私有绑定关闭公网，客户端拿不到内部证明，认证操作继续受原有会话/CSRF/幂等约束保护。禁止记录内部头/Secret。SSR 只有只读请求可使用单独ssr身份，不能用它发写请求。

`fetch-app` 接收由受信入口验证后的IP，默认本地模式不变；IP继续由业务HMAC后进入数据库限流桶。真实边缘头的行为、跨Worker来源和账号配置必须在授权后的云端阶段再次验证。

新 API 固定 production 安全语义、Secure/HttpOnly/Strict/\_\_Host- Cookie、精确HTTPS Origin；不传任何热土/匿名回归/费用实验/邮件 provider。封闭模式拒绝注册、验证、重发、忘记和重置密码接口；对应邮件页面503说明暂未开放。保留已有用户密码登录、主动改密、撤销及独立管理员体系。真实邮件就绪前不能开放注册，也不能公开测试邮件读取接口。

API 每次请求检查 AI control 关闭、单次金额上限零、所有预算limit为零；应用角色无写费用配置权限。Mock聊天使用固定回复，不开启 AiControl.fakeEnabled，也不需要任何模型密钥。游客仍只有预置演示。

## 独立数据库及角色流程（尚未执行远程操作）

仅使用全新、无生产数据的 PostgreSQL 测试项目。工具 `scripts/mock-preview-database.ts` 不自动创建数据库，不自动运行在服务启动时，不修改0001—0009。

Owner先在数据库控制台建立专用数据库 `pv_mock_*` 和独立迁移所有者 `pv_mock_migrator_*`。迁移账户应拥有目标表及必要DDL/创建受限角色权限；不要把该账户交给Worker。

在受控本机通过未跟踪的私有环境文件提供：

- APP_ENV=mock-preview
- PREVIEW_MIGRATION_URL：直连迁移URL，sslmode=verify-full；禁止pooler/Hyperdrive端点。
- PREVIEW_CONFIRMED_HOST、PREVIEW_CONFIRMED_DATABASE：逐字匹配目标。
- PREVIEW*APP_ROLE=pv_mock_app*\*：角色操作时提供。

执行 `node --env-file=<私有文件> --import tsx scripts/mock-preview-database.ts <migrate|role|owner|tester>`，每次要求TTY和完整host/database确认。不要在命令行输入连接串。

`migrate` 使用原样 Prisma migrate deploy；不自动reset/resolve或覆盖历史。首次执行前确认数据库空白，失败后停止并私下检查台账/事务状态；托管数据库需要再做0001—0009重放、checksum、失败回滚和约束验收。部分历史迁移没有外层事务，不应假定整个deploy全有或全无。

`role` 事务创建 NOLOGIN、非superuser/CREATEDB/CREATEROLE/BYPASSRLS的应用角色；只授业务必需DML，无DDL/TRUNCATE、schema CREATE、迁移台账权限。内核/审计/不可变账本禁止UPDATE/DELETE，费用配置与账本写操作关闭。角色不拥有任何表。之后站长用直连psql的 `\password <role>` 安全设置SCRAM密码，再明确启用LOGIN；不要把明文密码放进SQL编辑器、参数或日志。角色已存在时失败，不覆盖。未来新增迁移必须单独复核权限，不自动授未来表权限。

API每次请求还核实current_user/current_database、角色管理权限、表所有权、public CREATE及AiControl UPDATE权限，不合格503。

`owner`/`tester` 仅接受合成 @test.invalid 地址和交互隐藏密码，绝不覆盖既有账号。tester需再次输入OFFLINE-TEST-IDENTITY-CONFIRMED；emailVerifiedAt仅表示隔离合成账号的操作员确认，不代表真实邮件送达。Owner初始化写管理员审计。密码通过现有Argon2id参数生成；运行时仍使用私有DO验证。不要将初始化脚本发布成HTTP接口。

## Hyperdrive 与 Secret

创建资源仍需单独授权。API连接必须使用专用Hyperdrive binding，不接受任意DATABASE_URL。Hyperdrive源站指向专用测试PG的**直连端点及应用角色**，TLS校验不得关闭；不要叠加未经验证的双重事务池。迁移凭据只留本机。

必须在Hyperdrive控制台关闭查询缓存；创建配置的caching.disabled必须为true。模板默认HYPERDRIVE_CACHE_DISABLED=false并拒绝运行；`HYPERDRIVE_CACHE_DISABLED=true`只是操作者完成检查后的声明，**不能远程读取或证明真实配置**。远程缓存尚未验证，因此这仍是发布阻断条件；HTTP no-store不能代替SQL缓存关闭。

站长授权资源创建后：

1. 确认Workers Free/SQLite DO资格、免费额度；创建专用密码DO并先做合成密码云端CPU门禁。
2. 填三个独立Worker名称及绑定；只开放Web，禁止API/password公网、预览和routes。
3. 将两个配置的WEB_ORIGIN改为同一个精确https workers.dev地址；替换Hyperdrive ID、测试数据库与应用角色；占位符无法通过入口校验。
4. 在Web和API各保存同一个随机至少32字节BRIDGE_SECRET为Worker Secret。Hyperdrive凭据只放其安全配置；数据库密码不进入vars、前端、Git或构建日志。
5. 固定PV_WORKERS_ADAPTER=opennext、MOCK_PREVIEW=closed。保留静态WASM和workerd Prisma生成；先 `pnpm cf:client && pnpm cf:wasm && pnpm cf:build`。本轮未添加任何自动发布命令或Git部署绑定。
6. 先少量受邀测试，不向真实用户收集邮箱或私人聊天。检验CPU、DO duration、SQL/日额度、冷启动和撤销即时性，不能承诺一直免费。

撤销优先关闭唯一Web公网入口并撤销应用数据库凭据；保留快照供审核，不回退旧SQL迁移、不删除DO命名空间或其他线上资源，后续清理需另行批准。

## 剩余云端门禁

- 实际Free DO CPU及调用方CPU、内存、冷启动、并发、超时仍未验证。
- Neon/Hyperdrive TLS、事务池、缓存关闭、最小权限及完整跨设备链路未在云端验证。
- iPhone Safari真机、真实公网HTTPS和大陆网络可达性未验证。
- 心跳每10秒执行多条SQL；Hyperdrive每日100k SQL及Neon容量/计算小时需小流量测量，幂等事件的长期清理尚未实现。
