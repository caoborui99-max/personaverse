# 人格宇宙 PersonaVerse MVP

保留原生 HTML/CSS/JavaScript 首页、人格卡片、搜索、收藏、详情和提示词复制。新增管理员人格新增、编辑、上架、下架与软删除。增加明确标注的固定文案演示聊天；没有接入真实 AI、支付或会员。

## 本地运行

Node.js 24 推荐。执行 `npm install`，复制 `.env.example` 为 `.env`，填写 `ADMIN_EMAIL` 和至少12字符的 `ADMIN_PASSWORD`，再执行 `npm run dev`。打开 http://127.0.0.1:8000，后台 `/admin.html`。本地 SQLite 保存在 `.local/personaverse.sqlite`；重启、刷新和重新构建不覆盖现有资料。不要删除该数据库文件。

验证命令：`npm test`、`node tests/mvp.test.js`、`npm run build`。浏览器复现：安装 Python Playwright 与 Chromium 后运行 `python3 tests/browser_smoke.py`；可通过 `CHROMIUM_PATH` 指定浏览器。脚本使用临时数据库和随机测试密码，退出会关闭测试服务。它是 Chromium 手机尺寸模拟，不是实体 iPhone Safari 认证。无 TypeScript，不存在类型检查命令。旧版静态操作说明保留在 docs/static-v1.md。

## iPhone 部署

Vercel 导入现有 GitHub 仓库，选择包含本轮 MVP 的代码分支。Framework=Other，根目录保持默认，Build Command=`npm run build`，Output Directory=`public`，Install Command=`npm ci`。

通过 Vercel 的 Storage/Marketplace 连接免费 Neon PostgreSQL，或从 Neon 控制台复制连接串，填入服务器环境变量 `DATABASE_URL`。再设置 `ADMIN_EMAIL` 和强密码 `ADMIN_PASSWORD`。部署构建会自动建表、一次性导入12个人格。后续构建不会覆盖管理员编辑或恢复已删除的人格。生产环境缺少 DATABASE_URL 会明确拒绝数据操作，不会使用临时文件假装持久化。

完成后用 Safari 打开 Vercel 返回的 HTTPS 地址，进入 `/admin.html` 登录，点击「新增人格」，填写名称、简介、分类、头像 HTTPS 地址、系统提示词和状态后保存。已上架人格刷新首页可见；草稿及下架内容不对普通访客显示。头像可留空，沿用图标。无需重新部署即可发布新内容。

GitHub Pages 只能展示原静态功能，不能运行管理员后台或数据库。现有 Sites 在线站点不会因本地代码修改自动升级。本轮若未配置 Vercel/Neon，不代表新版已上线。没有购买服务；免费套餐额度及商业使用限制以供应商条款为准。

## 安全与范围

管理员密码只放在服务器环境变量，不存在默认密码。每次写入均由服务器验证管理员身份与请求来源；会话 Cookie 为 HttpOnly，数据库仅保存随机令牌的哈希。公开接口不返回私有人格系统提示词，新建人格默认不开放复制；原12个人格保留公开提示词复制功能。删除采用软删除，避免破坏历史引用。

本轮没有 AI API 调用，因此无需配置 DeepSeek Key。不要把任何密钥写到 HTML、js/、GitHub 或使用 VITE_/NEXT_PUBLIC_ 前缀。


## 第一阶段已验收范围

- 数据库动态查询：搜索 q、分类 category、排序 recommended/name、page/limit 分页（每次最多100条），后台另支持状态过滤；首页默认12条、后台默认20条。详情按独立ID读取，不依赖当前分页。
- 查询索引与角色变更在同一事务更新；SQLite 旧 MVP 数据及早期缺少公开状态列的索引会兼容升级。仅通过 `npm run db:migrate` 或启动/构建入口迁移；不要手工只运行一份 SQL 就假定全部兼容逻辑完成。
- 后台管理名称、头像地址、简介、背景、性格、语言风格、标签、精选、提示词复制权限、公开/私人、草稿/上架/下架，删除为软删除。前端收藏仍是本浏览器本地收藏。
- 保留12个原创初始人格，不在每次部署时覆盖管理员资料。`js/personas.js` 仅为明确标注的原版静态预览回退；新建人格从数据库读取，不需要改前端或重新部署。
- `/chat.html?id=...` 为固定文案演示，不调用任何模型；内容仅存当前页面内存，刷新即清空，不能当作真实聊天历史。未配置服务端时演示人格无法加载，会明确提示。

## 未验收与后续范围

实际 Neon/PostgreSQL 连接、Vercel Preview 路由和 Cookie、实体 iPhone Safari、中国大陆网络可达性与一万条数据性能仍未验证。LIKE 包含搜索不能承诺全文索引性能。批量导入/批量编辑、提示词版本回滚、用户注册和创作、审核、真实AI历史与额度、商业化、正式SEO与合规上线不属于本次已交付功能。不要依据本地通过就宣称生产上线、备案或收录成功。

当前收尾测试记录见 [docs/phase1-validation.md](docs/phase1-validation.md)。独立 Vercel 测试部署步骤见 [docs/vercel-test.md](docs/vercel-test.md)。所有真实凭据仅在服务端环境变量配置，禁止发到聊天或提交Git。
