# PersonaVerse：现有项目上线准备

## 来源和范围

基线：GitHub `caoborui99-max/personaverse`，`phase3/deepseek-minimum-test`，提交 `c8d50927f295af97f1bf3ec8a7fdf410b90239a8`。通过 GitHub 插件读取，100个文件逐一核对 Git blob SHA；本地导入文件树为 `d31273af40b34c946320ae3c5e0f9f8091ca40c7`，与远端树一致。本地验证副本不是原远端历史；远端修改提交直接以原 GitHub 提交为父提交。

继续使用原生 HTML/CSS/JS、移动端界面、搜索、分类、收藏、详情、后台、现有数据库适配器和 AI Provider。无框架重写。主站 `js/personas.js` 仅修改12个显示名称和明确自称；`scripts/check-personas.mjs` 在构建时逐字段核对前端与 `server/seed-data.js`。原 ID、背景、性格、其他提示词逐项保留。

`preview-dist`、`docs/preview`、`preview/static-mobile-v01` 与旧 Sites 不属于本轮上线目标，保留历史预览。旧库沿用原独立改名计划与审核机制，本轮没有连接、初始化或改名任何生产数据库。新测试库的种子直接使用新名称，启动和构建均不自动迁移。

## 已接好的真实聊天路径

人格详情 → `/chat.html?id=<原ID>` → 同源 `/api/ai/status` → 必要时 `/api/ai/session` → 用户主动发送 → `/api/ai/chat` → 原 `createProvider` → 服务端 `AI_BASE_URL` 的 `/chat/completions`。无主站模拟回复；未开启、配置不完整或连接失败时明确显示不可用，不伪装成成功。

使用现有 `AI_API_KEY`、`AI_BASE_URL`、`AI_MODEL` 服务端配置，不重写 Provider，不把模型默认值猜成可用型号。Key 只进入服务端出站 Authorization 请求头，不写前端、GitHub、测试报告或日志。Provider 继续限制20秒、256输出 Token，无重定向、无自动重试，错误体不透传。不把 Soul Core 内容注入模型请求。

### 两个明确的访问模式

- 默认 `AI_CHAT_ACCESS=admin`：保持原隔离测试，仅管理员、全站UTC每天1次、每管理员UTC分钟1次，环境变量不能放宽。
- 显式 `AI_CHAT_ACCESS=public`：访客创建随机 HttpOnly/Secure/SameSite=Strict Cookie，无需获得管理员密码；只在 AI 已开启且配置完整时创建。身份令牌仅以摘要存库，有效期24小时。服务端按身份隔离历史，拒绝客户端提示词/历史覆盖及访问私人、下架人格。
- public模式的 `AI_DAILY_LIMIT` 默认1、范围1..100，所有访客/管理员共享全站额度；`AI_RATE_LIMIT` 默认1、范围1..3，按身份每UTC分钟限制。清Cookie不能重置全站预算。每次失败仍保留扣减；重复请求ID不重复调用；并发身份锁继续生效。输出限额仍固定不超过256 Token。
- 公共访客模式只是小规模受限体验，不是完整注册系统；清Cookie会失去该访客历史访问权。访客会话创建接口没有验证码，匿名身份也不能阻止换Cookie，因此公开扩大前应评估机器人和数据库资源滥用。全站硬预算是费用上界，不是人类身份认证。清空页面只新建会话，不删除服务器记录；上线前需确定保留/删除政策。
- 页面说明 AI 身份、服务商处理和服务器存储。欢迎语明确标注非模型生成。页面加载和创建会话零模型请求；只有主动发送会请求服务商。

## 首选试运行：独立 Vercel + Neon 免费项目

复用现有 Vercel 入口 `api/index.js`、`vercel.json`、Neon适配器。Node 24，Framework=Other，根目录默认，Install=`npm ci`，Build=`npm run build`，Output=`public`。函数包含迁移SQL只供就绪校验读取，构建/请求都不运行迁移。

这是基础设施免费额度候选，不承诺永远免费。Vercel Hobby限非商业个人用途；真实 DeepSeek 调用依供应商账户和计费规则，不能承诺零费用。若本项目是商业运营用途，不应使用 Hobby，先停在此处重新选方案，不自动升级或付费。

中国大陆 iPhone/Safari 的页面、Cookie、服务端→Neon、服务端→DeepSeek均未实测。不能因供应商有免费计划或本地测试通过就宣称大陆可用。若实测不稳定，保留现有站点与本分支，不自动购买大陆服务器；原 `deploy/china` 可作为后续经预算批准的候选。

参考官方说明（核对日期2026-11-04）：

- https://vercel.com/docs/plans/hobby
- https://vercel.com/docs/git
- https://vercel.com/docs/project-configuration/git-configuration
- https://vercel.com/docs/environment-variables
- https://vercel.com/docs/functions/runtimes/node-js/node-js-versions
- https://neon.com/docs/introduction/free-tier

## 当前发布闸门与最少下一步

本轮不部署、不启用 AI、不初始化远端数据库、不运行 `scripts/deepseek-once.js`。`vercel.json` 的 `git.deploymentEnabled=false` 禁止本准备分支的 Git 自动部署；CI 不含部署、生产迁移或服务商调用。

1. 用户审核独立分支和测试结果，确认个人非商业用途，以及允许建立/使用独立免费测试项目。提供已有 Vercel/Neon 项目入口即可；不要提供密钥或连接串到聊天。当前 Codex 中 Key 配置已就绪，不要求重新填写；但当前任务密钥绑定不等于目标 Vercel 已有绑定。若不能通过受保护的机制复用到目标服务端，明确报告凭据迁移阻塞，不能把代理占位值复制为真实 Key。
2. 经批准后，在 iPhone Safari 用 GitHub 登录 Vercel，导入该仓库并明确选择经审核的独立分支，建立独立项目，不修改旧 Sites 域名。Neon只使用全新空测试库或已明确授权的独立测试库。**不要使用现有生产数据库。** 对已核对的测试库，由安全执行环境运行独立迁移并验收。手机没有安全数据库初始化入口时停止，不把 SQL/连接串放入公开网页或仓库。
3. 部署审批与首次真实API请求审批分别记录。第一次部署先保持 `AI_ENABLED=false`，核对12个名称、探索、搜索、收藏、详情、管理员权限、重部署数据持久化及Safari Cookie。之后明确批准一次真实请求，使用现有一次性测试器或主动发送一条受限管理员消息，最多16输出Token的独立测试器已有防重复标记。失败不重试；按认证、余额、模型、超时错误报告。
4. 确认真实Provider、目标网络及费用可接受后，再批准访客开关和具体全站额度。服务端设 `AI_CHAT_ACCESS=public`、`AI_ENABLED=true`，沿用现有密钥和准确的模型配置。开放前核验两个独立访客历史互不可读、私有人格不可用、限额和关闭开关行为。
5. 批准后才从本准备分支建立受控 `release/deepseek-chat`，把Vercel Production Branch指定为该发布分支，允许该分支Git部署；不用合并main。GitHub新提交→离线CI→审核→发布分支更新→Vercel自动部署。同一发布分支如要强制“CI通过后才发布”，应配置GitHub分支保护/规则集并要求离线检查，不要假设Vercel自动等待CI。本次未修改仓库规则集。

## 本轮验证边界

全部自动测试使用临时SQLite和合成凭据，单元测试预加载断网保护；Provider请求格式、12个人格的服务端消息、会话隔离、预算、失败不重试、幂等和回归均用Mock。Mock通过只能证明本地逻辑，不能证明DeepSeek实连、Neon事务或Vercel路由上线可用。

浏览器脚本区分主站“关闭AI后禁发”与显式离线夹具回复；截图只能作为移动尺寸审核，不是实体iPhone验收。实际执行结果见本轮交付报告。
