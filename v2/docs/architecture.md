# 第三阶段架构

## 两种明确隔离的模式

默认 API 服务为 database 模式，必须通过 APP_ENV 和 DATABASE_URL 校验。Fastify → 认证/人格/聊天服务 → Prisma → PostgreSQL。缺配置时拒绝启动；数据库不可用时返回 503，不退回模拟目录或假登录。

PV_MODE=mock-regression 仅用于保留第二阶段离线回归，使用原 apps/api/src/app.ts；该模式不连接数据库，管理员入口保持关闭。原测试和固定测试人格未删除，也不会导入正式目录。

Next.js 公开首页、广场和档案通过服务端调用同源 API 后端获取已发布资料并 SSR；交互搜索调用同一 REST 契约，收藏按公开 slug 再查当前可见资料。后端不缓存认证/聊天数据；站长草稿和公开发布快照分离。

Web rewrite /api/v1/\* → 独立 Node API，浏览器无需 CORS。服务器与浏览器请求均使用配置的 API_INTERNAL_URL，不以 NEXT_PUBLIC 暴露配置。后台 route group 在服务端读取实际 Cookie 并向 API 验证会话，未登录重定向 /admin/login，数据库故障进入错误页面。任何前端显示均不授予 API 权限。

## 模块

- config.ts：严格区分 development/test/production 与目标数据库。
- database-app.ts：统一错误、Origin、管理 API 鉴权、连接关闭。
- auth.ts：Argon2id、CSRF、令牌摘要、绝对/空闲过期、撤销、持久化登录限流和审计。
- personas.ts：事务、revision CAS、不可变快照与版本、发布/下架/归档、公开白名单。
- chat.ts：独立访客和管理员会话，固定版本，仅模拟回复。
- shared/api-client：Web 与未来 Expo 可复用的 Zod 数据契约、HTTP 客户端。

构建继续使用 Next webpack 与 TypeScript 编译器 API，严格检查开启。Tailwind 4 与黑白灰/柔和紫色设计保留；后台支持手机窄屏、完整内核文本和未保存提示。

## 扩展与限制

公开数据库搜索目前在服务器读取已发布快照后过滤/分页，适合当前内容规模；增长到大量人格前应建立只反映已发布快照的检索投影和索引，不能直接搜索可变草稿字段而泄露草稿。

尚无真实模型调用、付费、用户账户、私人副本、上传存储或 App。头像使用站长提供的 HTTPS 引用，不由服务器下载。原生 App 后续需要独立的安全凭据存储与认证传输方案。robots 仍禁止预览资料索引，正式发布网站前再审查 canonical/sitemap/索引策略。
