# 人格宇宙 PersonaVerse MVP

## 开发管理员额度第一阶段（独立分支，尚未部署）

仅显式 `AI_QUOTA_MODE=development` 且通过现有管理员鉴权的身份，免个人日/月次数限制；`NODE_ENV=development` 本身不会放开。分钟频率使用 `AI_ADMIN_RATE_LIMIT`（默认1，范围1..60），全站日/月费用预扣始终生效。预算、确切模型价格或持久化预扣缺失时禁止 Provider 调用。未新增普通用户、会员或完整后台额度系统。

新增 `0005_chat_cost_guard.sql`，旧迁移、12个人格、归属标识和历史表保留。真实调用前需要显式迁移并配置费用保护；AI保持关闭。详见 [第一阶段说明与待执行步骤](docs/dev-admin-quota-phase1.md)。

## 当前上线准备分支（尚未部署）

本轮基于 `phase3/deepseek-minimum-test` 的 `c8d50927f295af97f1bf3ec8a7fdf410b90239a8` 继续修复，不重建网站、不合并 main。当前前端12个人格与服务端种子完全一致；历史 `preview-dist`、`docs/preview` 及旧 Sites 仍保留原版。

主站聊天页已改为只显示 Provider 的真实返回：AI 未开启时禁止发送，不生成固定示例。管理员隔离模式仍是默认设置；另增显式 `AI_CHAT_ACCESS=public` 的访客会话，必须同时具备 `AI_ENABLED=true` 和完整服务端 Provider 配置才可聊天。仅网页加载、创建会话不会请求模型。密钥不进入前端或构建产物。

上线方案、权限/限额、免费方案边界、首次实连审批与后续 GitHub 自动更新步骤见 [上线准备与验收](docs/release-preparation.md)。`vercel.json` 当前禁止 Git 自动部署，等待明确批准后才开启；CI 只运行离线检查。以下原阶段说明为历史记录，不能视为本分支已上线或仍采用模拟聊天。

保留原生 HTML/CSS/JavaScript 首页、人格卡片、搜索、收藏、详情和提示词复制。新增管理员人格新增、编辑、上架、下架与软删除。增加明确标注的固定文案演示聊天；没有接入真实 AI、支付或会员。

## 本地运行

Node.js 24 推荐。执行 `npm install`，复制 `.env.example` 为 `.env`，填写 `ADMIN_EMAIL` 和至少12字符的 `ADMIN_PASSWORD`，先执行 `npm run db:migrate`，再执行 `npm run dev`。打开 http://127.0.0.1:8000，后台 `/admin.html`。本地 SQLite 保存在 `.local/personaverse.sqlite`；重启、刷新和重新构建不覆盖现有资料。不要删除该数据库文件。

验证命令：`npm test`、`node tests/mvp.test.js`、`npm run build`。浏览器复现：安装 Python Playwright 与 Chromium 后运行 `python3 tests/browser_smoke.py`；可通过 `CHROMIUM_PATH` 指定浏览器。脚本使用临时数据库和随机测试密码，退出会关闭测试服务。它是 Chromium 手机尺寸模拟，不是实体 iPhone Safari 认证。无 TypeScript，不存在类型检查命令。旧版静态操作说明保留在 docs/static-v1.md。

## iPhone 部署

Vercel 导入现有 GitHub 仓库，选择包含本轮 MVP 的代码分支。Framework=Other，根目录保持默认，Build Command=`npm run build`，Output Directory=`public`，Install Command=`npm ci`。

通过 Vercel 的 Storage/Marketplace 连接免费 Neon PostgreSQL，或从 Neon 控制台复制连接串，填入服务器环境变量 `DATABASE_URL`。再设置 `ADMIN_EMAIL` 和强密码 `ADMIN_PASSWORD`。构建仅生成前端文件，不连接数据库。数据库迁移必须作为独立操作，备份并核对目标后执行 `npm run db:migrate`；生产环境还需显式追加 `-- --confirm-production`。种子初始化保留现有编辑及软删除状态。生产环境缺少 DATABASE_URL 会明确拒绝数据操作，不会使用临时文件假装持久化。

完成后用 Safari 打开 Vercel 返回的 HTTPS 地址，进入 `/admin.html` 登录，点击「新增人格」，填写名称、简介、分类、头像 HTTPS 地址、系统提示词和状态后保存。已上架人格刷新首页可见；草稿及下架内容不对普通访客显示。头像可留空，沿用图标。无需重新部署即可发布新内容。

GitHub Pages 只能展示原静态功能，不能运行管理员后台或数据库。现有 Sites 在线站点不会因本地代码修改自动升级。本轮若未配置 Vercel/Neon，不代表新版已上线。没有购买服务；免费套餐额度及商业使用限制以供应商条款为准。

## 安全与范围

管理员密码只放在服务器环境变量，不存在默认密码。每次写入均由服务器验证管理员身份与请求来源；会话 Cookie 为 HttpOnly，数据库仅保存随机令牌的哈希。公开接口不返回私有人格系统提示词，新建人格默认不开放复制；原12个人格保留公开提示词复制功能。删除采用软删除，避免破坏历史引用。

本轮没有 AI API 调用，因此无需配置 DeepSeek Key。不要把任何密钥写到 HTML、js/、GitHub 或使用 VITE_/NEXT_PUBLIC_ 前缀。


## 第一阶段已验收范围

- 数据库动态查询：搜索 q、分类 category、排序 recommended/name、page/limit 分页（每次最多100条），后台另支持状态过滤；首页默认12条、后台默认20条。详情按独立ID读取，不依赖当前分页。
- 查询索引与角色变更在同一事务更新；SQLite 旧 MVP 数据及早期缺少公开状态列的索引会兼容升级。仅通过独立的 `npm run db:migrate` 迁移；启动和构建均不迁移；不要手工只运行一份 SQL 就假定全部兼容逻辑完成。
- 后台管理名称、头像地址、简介、背景、性格、语言风格、标签、精选、提示词复制权限、公开/私人、草稿/上架/下架，删除为软删除。前端收藏仍是本浏览器本地收藏。
- 保留12个原创初始人格，不在每次部署时覆盖管理员资料。`js/personas.js` 仅为明确标注的原版静态预览回退；新建人格从数据库读取，不需要改前端或重新部署。
- `/chat.html?id=...` 为固定文案演示，不调用任何模型；内容仅存当前页面内存，刷新即清空，不能当作真实聊天历史。未配置服务端时演示人格无法加载，会明确提示。

## 未验收与后续范围

实际 Neon/PostgreSQL 连接、Vercel Preview 路由和 Cookie、实体 iPhone Safari、中国大陆网络可达性与一万条数据性能仍未验证。LIKE 包含搜索不能承诺全文索引性能。批量导入/批量编辑、提示词版本回滚、用户注册和创作、审核、真实AI历史与额度、商业化、正式SEO与合规上线不属于本次已交付功能。不要依据本地通过就宣称生产上线、备案或收录成功。

当前收尾测试记录见 [docs/phase1-validation.md](docs/phase1-validation.md)。独立 Vercel 测试部署步骤见 [docs/vercel-test.md](docs/vercel-test.md)。所有真实凭据仅在服务端环境变量配置，禁止发到聊天或提交Git。


## 第二阶段最小AI接口（新增，默认关闭）

服务端已增加Token Rhythm/OpenAI Chat Completions兼容Provider与管理员多轮测试接口；默认仍为固定文案演示。此前“未接真实AI”的描述指未完成供应商实连验证，不代表没有接口代码。本轮没有调用收费API。安全配置、额度、Mock测试和iPhone首次手动开启说明见 [docs/ai-testing.md](docs/ai-testing.md)。新增变量仅放服务端：AI_ENABLED=false、AI_BASE_URL、AI_MODEL、AI_API_KEY、AI_DAILY_LIMIT、AI_RATE_LIMIT。AI_MODEL必须使用供应商实际模型ID；密钥不得发到聊天。


## 中国大陆单机部署适配（未部署）

预算上限50元/月，目标腾讯云大陆2核2GB，实际价格与续费需购买前核实，超过预算停止。新增显式生产SQLite持久路径、Nginx本机可信代理、systemd与日志轮转模板，以及一致性备份/新文件恢复验证。无额外数据库或面板月租；AI保持关闭，无收费调用。详见 [deploy/china/README.md](deploy/china/README.md)。本分支未购买、未公开部署、未合并；原Vercel文档仅为保留的可选方案。

## 工程整合检查点

整合分支基于 Preview 0.1，静态发布源保持不变。变更、测试边界与回滚说明见 [docs/integration-validation.md](docs/integration-validation.md)。生产迁移确认参数仅防止误执行，不替代备份、权限和目标核对。

## Soul Core 最小架构（未接真实 AI）

所有数据库人格自动关联唯一 `shared` 核心，独立 ID、背景、性格和提示词保留。初始草稿严格为空，无已发布版本。管理员登录后台后展开“共享 Soul Core”，点击载入，手动编辑并保存草稿；发布和回滚需再次确认。普通访客没有读取核心原文的接口。

启动现在只检查数据库就绪，不自动建表或初始化。新库和旧库必须先单独迁移：本地 `npm run db:migrate`；生产标记下需在备份、核对目标后显式 `npm run db:migrate -- --confirm-production`，本轮没有执行生产迁移。已执行的 SQL 文件不得修改；校验和不匹配会拒绝启动/API。详见 [Soul Core 验收与迁移说明](docs/soul-core-validation.md)。共享核心仅建立数据引用，尚未加入模型请求；AI 保持关闭。

## DeepSeek 隔离测试检查点

第三阶段基于远程54c07d6继续，真实AI仍关闭，所有验证仅Mock。管理员聊天测试全站每日最多1次、每管理员每UTC分钟最多1次，环境变量不能放宽。Provider最多256输出Token、默认20秒超时、无自动重试，不注入Core。详见 [本轮测试与限制](docs/deepseek-isolation-validation.md)。

## 十二人格正式命名

数据库新建种子采用晚柠、MIRA、零序、KAI-07、阿序、洛伊、北辰、弦月、小满、NOVA、黑胶先生、砚白；原ID不变。种子初始化不覆盖管理员已有资料。旧库必须单独生成并审核名称计划后应用，不随启动、构建或常规schema迁移自动更名。静态Preview 0.1继续保留原发布版本。详见 [正式名称迁移说明](docs/persona-names.md)。
