# REST API v1

当前可执行契约见 openapi.json，由 shared Zod schema 生成；命令 pnpm contracts:generate。JSON 是标准 OpenAPI 格式，不额外维护易漂移的 YAML 副本。

成功聊天返回 {id,personaSlug,messages,mode:"mock"}。消息格式见 shared.Message。错误统一 {error:{code,message,requestId,retryable}}，保留 HTTP 状态。429 频率限制提供 Retry-After。

公开：GET /health、/personas?q=&category=&page=&limit=、/personas/:slug、/categories。

访客：POST /visitor/session（空 JSON）；POST /chat/sessions {personaSlug}；GET /chat/sessions/:id/messages；POST 同路径 {clientMessageId,content}；DELETE /chat/sessions。每项聊天操作均核对 Cookie 归属。写操作要求配置的 Origin；跨站请求 403。浏览器经同源 rewrite 使用；不开放 CORS。

管理员：POST /admin/auth/login 返回 503 AUTH_NOT_IMPLEMENTED；/admin/auth/session、/admin/auth/logout、/admin/personas 及所有其他管理路径默认拒绝。没有后台读写或真实撤销功能。

未来预留（未实现）：管理员人格 CRUD、分类 CRUD、版本追加/恢复、发布下架、头像上传、导入导出、未发布人格测试会话、模型配置、额度管理、运行状态和审计查询。它们也必须位于受保护 /admin 命名空间。

未来 App 使用同一 v1 API，原生认证传输策略需独立设计。版本升级不能悄悄改变 v1 的权限和错误语义。
