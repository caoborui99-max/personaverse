# 架构与模块边界

## 第一阶段已实现

- pnpm workspace：apps/web、apps/api、packages/shared、packages/api-client。
- Next.js App Router + React + Tailwind 4；严格 TypeScript。公开页面 SSR/预渲染，聊天与收藏为客户端交互。
- Fastify 独立 API，统一 /api/v1，Zod 校验输入，错误格式与拒绝策略统一处理。
- 公共 schema 定义为共享包；Web/App 可复用 API 客户端。为保持编译后的独立 Node 服务可运行，API 使用共享源码相对导入，tsc 输出时重写 .ts 后缀。
- Web rewrite 同源转发 /api/v1/\* 到回环 API，浏览器不需 CORS。API 地址不以 NEXT_PUBLIC 暴露。
- 公共设计变量集中在 globals.css :root；黑白灰、柔和紫色，移动导航、动态视口与安全区。

页面只读使用同一组中性 fixture，并由 Next 输出 HTML；搜索/收藏在客户端使用这两个测试条目。API 提供独立的列表、查询、分页契约，为后续真实仓储替换做准备。此阶段没有假装页面在查询数据库。

API 内存仓储、cookie、限流仅用于回环地址的 mock 演示，不能直接用于多实例生产。登录、数据库、模型提供方均关闭。生产配置、跨实例限流与成本熔断在真实 AI 开启前必须完成。

## 后续替换边界

Fastify 路由 → 服务层 → PostgreSQL 仓储/权限策略 → DeepSeek provider。正式接入时保留 shared schema、API 客户端与界面交互；替换内存仓储和固定回复。管理员策略单独实现，任何客户端字段都不能决定身份。

未来 Expo 复用 /api/v1、shared 的领域数据契约和 api-client；需单独实现原生凭据传输与安全存储策略，不能假设浏览器 Cookie 自动适用于 App。

正式公开人格上线前补充 canonical、sitemap、结构化数据、发布缓存失效和搜索收录验收。目前机器人禁止收录测试资料。无用户账户、订单、支付或私人副本业务。
