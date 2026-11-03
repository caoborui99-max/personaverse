# 独立 Vercel 测试部署

现有 chatgpt.site 不作任何修改。使用现有 GitHub 仓库 caoborui99-max/personaverse，代码分支 upgrade/mobile-admin-chat；建议创建独立 Vercel 项目 personaverse-test，不关联现有域名。

## iPhone 操作

1. Safari 打开 https://vercel.com/new ，用 GitHub 登录。选择个人 Hobby 免费方案，不开通付费试用。
2. 导入上述仓库。若看不到它，Configure GitHub App 中只授权这个仓库。
3. 确保部署代码引用为 upgrade/mobile-admin-chat。若导入页只显示 main，先建立测试项目，再到 Settings → Git 设置 Production Branch 为 upgrade/mobile-admin-chat，并从 Deployments → Create Deployment 选择该分支。未配置环境变量前构建失败属于预期保护，不代表代码已经上线。
4. Framework=Other，Root Directory=仓库根目录，Node=24.x，Install=npm ci，Build=npm run build，Output=public。仓库 vercel.json 已配置命令。
5. 在 Neon 创建一个独立的免费测试数据库（https://console.neon.tech/），或在 Vercel Storage/Marketplace 连接 Neon 免费计划。不要复用正式数据库。复制 PostgreSQL 连接串。
6. Vercel 项目 Settings → Environment Variables 添加 DATABASE_URL、ADMIN_EMAIL、ADMIN_PASSWORD。密码至少12字符，建议密码管理器随机生成。将变量应用到实际部署使用的环境：测试项目的 Production，及需要的 Preview。没有默认管理员密码。
7. 点击 Redeploy，使用更新的环境变量；首次构建会自动建表并导入12个人格，后续部署不会覆盖编辑。数据库连接失败会终止构建。
8. 成功后复制 Vercel 实际给出的 HTTPS 地址。不要把 GitHub 仓库地址或尚未生成的域名当作测试地址。

所有真实密钥仅在供应商控制台输入，不发到聊天、不写到 GitHub。不需要 AI API Key。本项目未连接 AI 聊天。

## 实际地址生成后的验收

- 首页显示12个人格，搜索、详情、复制和收藏正常。
- GET /api/session 返回 JSON；未登录访问 /api/admin/personas 被拒绝。
- 用 /admin.html 登录，新增测试人格并发布；刷新首页可见，编辑和下架立即生效。
- 退出后无法修改人格；重新登录后原资料保留。
- 在 Vercel 再部署同一代码，确认测试人格仍存在：验证使用外部 Neon，而非临时文件。
- 手机检查头像、表单、按钮和横向滚动。

本地 SQLite 测试已覆盖 CRUD、重开数据库、种子保护、权限、跨域及私有提示词。真实 Neon 连接、Vercel 路由与 Cookie 必须在实际测试地址上验收；尚未执行不能视为通过。只有获得实际地址并完成这些检查后，才能报告测试部署成功。
