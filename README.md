# 不见真我 · PersonaVerse

在原有 HTML、CSS、JavaScript 网站上增量增加手机管理后台、数据库与人格聊天。原有宇宙视觉、分类搜索、人格详情、提示词复制与本地收藏继续保留。旧静态版说明见 [docs/static-v1.md](docs/static-v1.md)。

## 当前实现与上线边界

- 原在线 Sites 网站继续保留，升级代码在 GitHub 分支中验证；不要把旧在线地址当作新版后台已上线。
- 新版需要服务端与持久化数据库。GitHub Pages 只能展示静态前端，不能运行后台、保护 API 密钥或提供数据库聊天。
- 推荐 Vercel + Neon PostgreSQL 免费额度方案。未配置数据库、管理员或 DeepSeek 密钥时，界面和 API 会明确提示，不会伪造聊天、统计或数据保存成功。
- 真实 API 调用会使用 DeepSeek 账户余额；没有设置 DEEPSEEK_API_KEY 时不会发起模型请求。

## 功能

- 手机后台：人格新增、编辑、草稿、发布、下架、软删除、分类管理、标签、HTTPS 头像、欢迎语、开场白、示例问题、排序与搜索。
- 系统提示词由服务器保存和读取。普通用户不能修改服务器上的人格或给聊天接口覆盖 system role。管理员可选择开放提示词复制；已有 12 个人格保留复制行为。
- 持久化：人格、用户、会话、消息、额度、收藏保存到数据库；初始化只执行一次，不会在重新部署时覆盖后台编辑或恢复已删除的人格。
- 聊天：独立人格提示词、数据库历史、加载/失败/重发、重复请求保护、每天每用户额度；未配置密钥明确禁用。
- 预留免费/高级人格、用户账户、会员层级、个人额度和真实使用统计；未连接支付。

## iPhone 从 GitHub 部署到 Vercel

1. 登录 [Vercel](https://vercel.com/new)，使用 GitHub 账号导入现有仓库 `caoborui99-max/personaverse`。无需重新创建仓库。
2. 选择包含升级代码的分支。若还在验收阶段，选择 `upgrade/mobile-admin-chat`；合并后选择 `main`。
3. Framework 选择 **Other**，Root Directory 保持仓库根目录。Build Command 为 `npm run build`，Output Directory 为 `public`，Install Command 为 `npm install`。仓库的 vercel.json 已提供这些配置。
4. 在 Vercel Storage/Marketplace 连接 **Neon** 的免费计划，或在 [Neon](https://console.neon.tech/) 创建免费 PostgreSQL 数据库，然后把连接串填入 Vercel 环境变量 `DATABASE_URL`。用复制按钮获取连接串，不要发布到 GitHub。
5. 在 Vercel 项目的 Settings → Environment Variables 设置下面的服务端变量。只需在手机浏览器操作，未填的 API 密钥可稍后添加。
6. 点击 Deploy/Redeploy。构建会在服务端自动执行幂等数据库迁移和初始内容导入，手机用户不需要运行 SQL 或终端。
7. 构建成功后，打开 Vercel 提供的 HTTPS 地址。后台入口为该地址后面加 `/admin.html`。
8. 不选择付费试用、付费计划或购买域名。Vercel Hobby 适合个人非商业项目，商业运营前请核对供应商套餐条款。免费额度、暂停与资源限制以各供应商为准。

| 环境变量 | 用途 |
|---|---|
| DATABASE_URL | Neon PostgreSQL 连接串，生产持久化必需 |
| ADMIN_EMAIL | 管理员登录邮箱 |
| ADMIN_PASSWORD | 管理员强密码，至少 12 字符，不存在默认密码 |
| DEEPSEEK_API_KEY | 可选，DeepSeek 服务端密钥；未设置时聊天不可用 |
| DEEPSEEK_MODEL | 默认 deepseek-chat |
| ALLOW_REGISTRATION | false 关闭普通用户注册；默认允许 |

所有变量仅保存在 Vercel 服务端配置。禁止加 NEXT_PUBLIC_ 或 VITE_ 前缀，禁止写入 js/、HTML、GitHub 文件或聊天记录。Production 与 Preview 的数据库和密钥按需隔离；测试不需要真实模型密钥。

## 手机新增第一个人格

1. 打开新版的 `/admin.html`，使用上面配置的管理员邮箱和密码登录。
2. 点击「新增人格」，填写名称、简介、分类、标签、头像地址和系统提示词。
3. 设置欢迎语、开场白与示例问题，选择免费或高级人格、排序位置以及是否开放提示词复制。
4. 可以先「保存草稿」，以后再打开继续编辑；草稿不会出现在前台。
5. 点击「发布」。刷新首页，即可看到刚发布的人格，不需要重新部署。
6. 点击人格开始聊天。用户需登录；若服务端未配置 DeepSeek 密钥，会显示明确提示，不会产生假回复或模型费用。

## 本地开发与检查

需要 Node.js 24（推荐）。此部分供以后有电脑时使用，不影响上述 iPhone 部署。

```bash
npm install
cp .env.example .env
# 在 .env 中填写本地管理员邮箱与强密码；不要提交 .env。
npm run dev
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

本地使用 `.local/personaverse.sqlite`，只适用于开发。Vercel/生产环境绝不会回退到临时文件或内存充当数据库。数据库迁移也可以单独运行 `npm run db:migrate`。

## 验证与保护

GitHub Actions 工作流 `Platform checks` 执行服务端测试、构建和手机浏览器测试。结果必须以具体 workflow run 为准；源文件中存在测试不等于已经运行成功。

API 对每次管理员操作校验身份与权限，对会话逐项校验所有权。会话令牌只以哈希存储，Cookie 使用 HttpOnly/SameSite；写操作校验同源 Origin。模型请求限制上下文、输出和超时，并以数据库处理并发与重复请求，客户端不接触密钥。每日额度按 UTC 自然日计算。统计只来自真实数据库记录。删除人格采用软删除，保留历史引用。

如果将来接回 Sites 服务端，可利用其受信任身份网关和 D1 适配；不能在 Vercel 信任来自浏览器的 oai-* 请求头。本次独立部署入口为 Vercel + Neon，旧 Sites 地址不会自动升级。
