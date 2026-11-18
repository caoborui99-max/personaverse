# PersonaVerse 2.0 生产候选版本

本配置是待验收的生产候选，不表示已经上线。保留本地/Mock入口、原账号、人格版本、收藏、聊天归属和0001—0009历史迁移；新增0010只允许真实价格/账本标记，不自动启用AI、不注入预算、不改写旧财务记录。生产代码不注入热土Provider，Web入口拒绝其路由。

## 请求和费用边界

真实用户POST `/api/v1/me/chats/:id/messages`继续使用clientMessageId幂等键、同源CSRF和本地已验证会话。生产只有配置DeepSeek时才回复真实结果，否则503，绝不降级成假回复。Node开发需显式PV_AI_ENABLED=1及DEEPSEEK_API_KEY；生产Worker需AI_ENABLED=true及Secret。

固定 `https://api.deepseek.com/chat/completions`，deepseek-chat、非流式、输出上限1024、60秒超时、128KiB响应上限、不跟随重定向、不自动重试。用户及IP分钟/日调用限额、每日60分钟/100000保守Token额度、会话互斥、全局运行并发、单次费用和全站日/月预算共同生效。按UTF-8字节上界预留上下文加最大输出额度；个人额度在准入时扣除，失败也不退还，避免失败刷接口；这不是DeepSeek实际Token计费。账本使用1e-8货币单位整数；实际usage只在响应完整、合法并成功入库时结算。价格版本固定为deepseek-chat-production-v1，必须先核实当前模型价格和上界，不能使用测试价格上线。

派发先持久化running/fence，再发起一次网络请求。相同幂等键不会再次派发；响应丢失、截断、错误usage、网络/HTTP失败或结算失败一律保留预算并熔断，不假定免费。崩溃后的running由5分钟Cron（或下一次真实聊天请求）转unknown；过期reserved释放。unknown不自动重放。无法保证上游绝对不会重复计费，本实现保证应用不因重试再次派发已准入请求。

unknown需人工取得供应商账单证据，调用现有BudgetEngine.reconcile（证据SHA256，结算实际费用或有据释放），不重建请求或删除账本；再单独审核是否关闭circuitOpen。人工结算不重构丢失的模型回复。生产应用角色不得修改预算上限/价格，允许UPDATE AiControl(circuitOpen,reason)用于熔断，以及UPDATE AiBudget(reservedUnits,spentUnits)。其他按业务所需DML最小授权，历史价格/账本/usage/event/hold不授予UPDATE/DELETE；表与schema所有者、迁移身份必须独立。运行入口检查高权限角色、表所有权、schema CREATE和预算控制修改权限，拒绝不符合条件的身份。SQL权限还需在目标库独立验收，不能仅依赖角色名称。

## 构建与本地检查（不联网调用模型）

在v2目录执行：

```sh
pnpm install --frozen-lockfile
pnpm db:generate
pnpm cf:client
pnpm cf:wasm
pnpm typecheck
pnpm cf:typecheck
pnpm test
pnpm db:test:start # 仅当.env.test.local尚不存在
pnpm test:database
pnpm build
PV_CHROMIUM_PATH=/usr/bin/chromium pnpm test:e2e
PV_CHROMIUM_PATH=/usr/bin/chromium pnpm test:database:e2e
PV_CHROMIUM_PATH=/usr/bin/chromium pnpm test:login:e2e
pnpm cf:build
node scripts/production-dry-run.mjs
```

串行运行构建及浏览器套件。数据库测试脚本只接受回环隔离personaverse_v2_test，绝不指向生产。测试仅注入合成DeepSeek响应，没有付费模型调用。cf:build是OpenNext目标构建；production-dry-run只打包，不创建或上传资源。

## 上线前必须完成（本次未执行）

1. 使用已审核的专用V2 PostgreSQL，保留原数据；先做可恢复备份和离线迁移演练。迁移账户与应用角色分离，审核权限；不得拿生产库运行测试。受控迁移终端设置DATABASE_URL后执行 `pnpm exec prisma migrate deploy --schema database/schema.prisma`，只追加迁移，不reset、不覆盖数据。数据库连接不传入前端。
2. 预先配置Hyperdrive、验证TLS和目标数据库/角色，**实际关闭查询缓存**；再将api.jsonc的HYPERDRIVE_CACHE_DISABLED设为true，本地声明不能证明远程设置。
3. 修改cloudflare/production/{web,api}.jsonc中的相同固定HTTPS WEB_ORIGIN、Hyperdrive ID、PRODUCTION_DATABASE、PRODUCTION_ROLE和已验证MAIL_FROM。全部Worker默认workers_dev=false、preview_urls=false，API/密码Worker始终私有。不得复制本地邮件或诊断入口到生产。
4. 邮件使用Resend服务端API，先验证发件域、限额和实际到达/失败/过期场景；费用及额度需运营者确认，不默认视为免费。邮件Token只放URL fragment，不进入HTTP查询/Referrer。没有有效邮件配置时注册/重置不伪造投递成功。
5. 用独立迁移/运营身份创建非模拟AiPrice、当日和当月AiBudget，并设置AiControl。inputUnits/outputUnits为每Token的1e-8货币单位，输入按最贵未缓存价格向上取整。价格与供应商当前型号匹配；币种一致。必须显式设maxRequestUnits、maxInputTokens、maxOutputTokens(>=1024)、maxRunning、ratePerMinute、requestsPerDay、priceVersion；全部默认零/空会拒绝请求。预算scope为global-day/global-month，subject为global，period为UTC YYYY-MM-DD/YYYY-MM；个人额度按北京时间计算。跨日/月未预置预算会安全停服，不自动扩预算。无模拟价格或测试样本可用于正式计费。
6. 确认Cloudflare套餐和密码DO的资源限制；本地测试不能证明边缘CPU/内存/费用符合要求。不得擅自升级付费套餐。
7. 检查GitHub/Cloudflare自动构建和外部钩子；开发分支推送不能等同上线授权。正式公开前需要私有环境真实HTTPS、邮件、限额、账单对账、崩溃恢复、管理员发布/下架、物理Safari及地域网络验收。

## Secrets与部署命令（准备完成并获准后执行，本次未部署）

在v2目录执行。DEEPSEEK_API_KEY仅API使用，RESEND_API_KEY仅API使用；BRIDGE_SECRET为至少32字节的随机值，Web/API必须完全相同。Wrangler交互输入，禁止将值写到命令参数、Git或聊天。Hyperdrive包含应用连接凭据；PASSWORD Worker无密钥。

```sh
pnpm exec wrangler secret put DEEPSEEK_API_KEY --config cloudflare/production/api.jsonc
pnpm exec wrangler secret put RESEND_API_KEY --config cloudflare/production/api.jsonc
pnpm exec wrangler secret put BRIDGE_SECRET --config cloudflare/production/api.jsonc
pnpm exec wrangler secret put BRIDGE_SECRET --config cloudflare/production/web.jsonc

pnpm cf:client
pnpm cf:wasm
pnpm cf:build
node scripts/production-dry-run.mjs
pnpm exec wrangler deploy --config cloudflare/production/password.jsonc
pnpm exec wrangler deploy --config cloudflare/production/api.jsonc
pnpm exec wrangler deploy --config cloudflare/production/web.jsonc
```

上述命令不会自动添加公网路由，AI_ENABLED默认false。确认私有验收、预算及Secrets后再显式将AI_ENABLED设为true并重新部署API。最终公开前将Web的routes设为已审核的自有域名路由（zone_name和pattern必须与实际域名一致），再次部署Web。域名/account/Hyperdrive ID未知，因此不提供假造的可用域名，也不执行开放命令。回滚先将AI_ENABLED=false重新部署API，保留未知费用占用和数据；不要自动回退数据库迁移。
