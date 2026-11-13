# REST API /api/v1

OpenAPI 3.1 见 openapi.json，运行 pnpm contracts:generate 从共享 Zod 契约生成。错误统一 {error:{code,message,requestId,retryable}}，使用正确 HTTP 状态，不泄露数据库错误详情。

## 公开

GET /health 实际检查 PostgreSQL 连接，数据库断开返回 503；标明 ai:not-connected。GET /personas 支持 q/category/page/limit，GET /personas/:slug 只读取已发布且非测试人格。GET /categories 返回已发布快照引用的分类。公开字段白名单不含 coreText、草稿、管理员、审计或令牌。

POST /visitor/session 建立独立匿名 Cookie；POST /chat/sessions {personaSlug} 绑定当时发布版本；GET/POST /chat/sessions/:id/messages 查询/发送（消息包含 clientMessageId、content），DELETE /chat/sessions 清除当前访客所有会话。回复仍为 mock。下架后普通访客不可继续查询或发送该人格聊天。

## 管理员认证

GET /admin/auth/csrf → 预登录 CSRF。
POST /admin/auth/login {email,password} → 创建 Cookie，必须随后 GET /admin/auth/session 确认。
GET /admin/auth/session → admin{id,email,role} + csrfToken。
POST /admin/auth/logout → 立即撤销当前会话。
POST /admin/auth/password {currentPassword,newPassword} → 改密并撤销所有会话。

所有写操作校验可信 Origin；管理员写操作还校验 X-CSRF-Token。除 login/csrf 入口，所有 /admin 路径统一要求有效会话。viewer 可读与管理自己的会话，内容写入要求 owner。

## 人格与版本

GET/POST /admin/categories：查询/创建分类，创建字段 name、slug。
GET /admin/personas?q=&status=&category=&page=&limit=：后台搜索筛选。
POST /admin/personas {}：创建空白草稿；测试专用可传 isTest:true，永不自动发布。
GET /admin/personas/:id：完整草稿与当前版本。
PUT /admin/personas/:id：SaveDraft（含 expectedRevision）。完整手工字段：name、slug、summary、background、avatarUrl、tags、categoryIds、coreText、openingMessage。
POST /admin/personas/:id/publish、unpublish、archive：{expectedRevision}，安全归档代替破坏性删除。
GET /admin/personas/:id/versions：不可变版本列表、原文、作者、快照及来源。
GET /admin/personas/:id/compare?from=UUID&to=UUID：两份原文及变化字段，并排比较。
POST /admin/personas/:id/restore {versionId,expectedRevision}：恢复为新草稿版本。

客户端旧修订返回 409 EDIT_CONFLICT，不能用重试绕过冲突。发布缺字段返回 400，不代填内容。发布与草稿指针分离。

## 管理员指定版本测试

POST /admin/test/sessions {personaId,versionId}；GET/POST /admin/test/sessions/:id/messages。仅已验证管理员可用，支持未发布版本，固定 coreVersionId，不套用访客次数或每日额度。消息事务使用 NOWAIT 并发锁与 10 秒事务上限，HTTP/客户端超时保护，未配置任何模型调用路径，不产生真实费用。真实模型启用前还必须实现全站费用熔断和结算。

PV_MODE=mock-regression 保留第二阶段的 mock 登录拒绝、固定测试资料和内存聊天，仅供回归，不应当作真实认证模式。
