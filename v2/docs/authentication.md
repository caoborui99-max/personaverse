# 管理员认证

## 当前行为

/admin 在服务端无条件重定向 /admin/login。登录表单不可提交。POST /api/v1/admin/auth/login 在正确 Origin 下返回 503 AUTH_NOT_IMPLEMENTED，不签发 Cookie。其他任何 /api/v1/admin 路径默认 401；跨源写请求先返回 403。包括未知路由，伪造 Cookie、Bearer admin、x-admin 都不能授予权限。

没有前端 isAdmin 状态或假登录。访客只拥有 mock Cookie，不能访问管理员资源。数据库与真实会话未接入。

## 正式实现方案（未实现）

- 独立 AdminAccount，密码 Argon2id 加盐哈希；无环境明文密码作为长期账户。
- 256 位随机不透明会话令牌；数据库只存 SHA-256 摘要，支持空闲/绝对到期、退出及改密撤销。
- 生产 \_\_Host- Cookie、Secure、HttpOnly、SameSite=Lax、Path=/，不设置 Domain。
- 精确可信 Origin + 会话绑定 CSRF token；登录防 CSRF；反向代理配置显式声明，不信任任意 forwarded 头。
- 密码登录成功后再次请求真实会话并确认后才显示后台。
- 管理员与访客独立表、Cookie 和解析器；所有管理 API 统一服务端鉴权。
- 数据库故障返回 503 并拒绝访问；401/403/429 与配置错误分开处理，日志不含凭据。
- 来源与账户组合登录限流；管理员行为追加审计。
- 管理员可测试未发布人格，不受访客次数、每日额度或付费检查。仍受请求超时、并发保护与全站费用熔断。

以上生产行为均有 todo 测试占位，未虚报为本阶段已实现。
