# 第一阶段交付状态

验收环境：2026-11-13，Node.js 24.22.1，pnpm 11.25.0，Linux 系统 Chromium；浏览器测试使用本地构建产物与回环 API。

## 已完成

- 独立 pnpm workspace、严格 TypeScript、Next.js/Tailwind、Fastify、Zod 共享契约与 API 客户端。
- 七类页面、公开资料服务端 HTML、搜索筛选、当前设备收藏、移动适配。
- mock 多轮聊天、稳定会话 ID、幂等、失败重试、刷新恢复、人格切换、清除记录、存储降级和过期重连。
- 管理入口关闭；管理 API 默认拒绝；登录接口明确未实现。
- PostgreSQL/Prisma 数据模型、离线生成迁移、不可变版本与所有者约束 SQL。
- OpenAPI、架构、认证、聊天、备份恢复与开发文档。

## 最终验证

| 检查                                     | 结果                                          |
| ---------------------------------------- | --------------------------------------------- |
| pnpm install --frozen-lockfile --offline | 通过：锁文件可复用                            |
| pnpm typecheck                           | 通过                                          |
| pnpm test                                | 14 passed，6 todo，0 failed                   |
| pnpm build                               | Fastify TypeScript 与 Next.js 生产构建通过    |
| Prisma validate                          | 通过，未建立数据库连接                        |
| Prisma generate                          | 通过，未建立数据库连接                        |
| Playwright                               | 11 passed，0 failed                           |
| 移动布局                                 | 320、375、390、768、1440px 六条路由无水平溢出 |

Playwright 包含公开 SSR、搜索收藏、管理员拒绝、20 轮对话、输入框恢复、稳定 ID、刷新恢复、失败后刷新/重试、客户端导航切换人格、清除、断网重试、禁用/损坏存储、过期重连，以及响应丢失后通过服务器历史确认已保存消息。

## 修正与环境适配

初轮测试发现 TypeScript 严格错误和工作区依赖声明遗漏，已修正并重跑。初轮浏览器 8 通过、1 失败，失败原因是错误提示定位匹配到 Next.js 自带 route announcer；改为精确定位聊天错误区，未放松行为断言。之后增加额外恢复测试。

此执行环境中默认 Turbopack 内部端口通信失败；使用 webpack。Next 默认 TypeScript CLI 配置解析路径失败；针对固定 TypeScript 5.9 使用编译器 API，严格类型检查保持开启。最终构建和浏览器测试通过。开发仍可使用 Next dev，生产 build 显式 --webpack。

## 未实现与限制

6 项 todo：真实 Argon2id 登录；PostgreSQL 会话到期/撤销；正式 CSRF token/可信代理；管理员未发布人格聊天及免访客额度；DeepSeek 与费用熔断；PostgreSQL 实际迁移/约束/恢复演练。

未实现人格编辑器、头像上传、版本操作 UI、发布下架、正式内容、真实 AI、数据库运行时连接、支付、App。模拟回复不是 AI，内存记录不具备持久化保障。机器人禁止索引测试资料。实体 iPhone 键盘与 Safari 尚未实机验收，Chromium 视口检查不能替代实机验收。

没有操作生产服务器、旧端口、数据库、Nginx、systemd、生产环境变量或部署。所有变更限定 v2/。本地开发分支 feat/v2-minimal-mobile-ui；交付本地提交，不推送远程、不创建 PR，避免未知外部部署钩子。

下一阶段建议先在隔离 PostgreSQL 中执行迁移与约束测试，再实现管理员真实认证、审计和站长人格编辑/版本管理；完成后才进入 DeepSeek 多轮调用、额度与费用熔断。生产部署需另行审核。
