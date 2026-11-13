# 管理员认证与安全边界

## 账户和 Cookie

唯一邮箱 trim/lowercase；密码 Argon2id（19456 KiB、2 次、parallelism=1）加随机盐。初始化必须独立交互执行，没有默认账户或密码。owner 具有内容修改权限，viewer 只读；未认证 401，权限不足/CSRF 403，数据库不可用 503。

登录生成随机 256 位不透明令牌，数据库仅保存 SHA-256 摘要。会话绝对期限 12 小时、空闲期限 30 分钟，每次访问验证管理员状态与 authVersion。退出立即撤销当前会话；修改密码在事务内增加 authVersion 并撤销全部旧会话。登录与改密的并发使用行锁/条件更新，防止凭据变更后创建有效旧凭据会话。

HTTPS 使用 \_\_Host-pv_v2_admin，Secure/HttpOnly/SameSite=Strict/Path=/，无 Domain。HTTP 本地使用独立 pv_v2_admin_local，永不依赖客户端头部判断 HTTPS。production 必须配置 HTTPS 与明确的数据库安全确认。匿名访客采用独立 Cookie 和 VisitorSession，不能被识别为管理员。

## Origin 与 CSRF

所有写请求的 Origin 必须精确等于配置 WEB_ORIGIN，拒绝跨站 Sec-Fetch-Site。不开放宽泛 CORS，不信任任意 Forwarded 头。

登录前 GET /admin/auth/csrf 产生随机 HttpOnly 预登录 Cookie，返回由该 Cookie 派生的 CSRF token；POST login 必须同时有对应 Cookie 与 X-CSRF-Token。登录成功后 GET session 再次确认实际持久会话并返回会话绑定 token；其他管理写请求都要求该 token。仅收到登录 200 不会打开后台。

登录限流持久化于 LoginAttempt：每 15 分钟账户 10 次、来源 30 次，包含成功与失败尝试。来源使用实际 req.ip，trustProxy=false；同源开发代理会聚合为 loopback 来源，这是一项保守保护，不采信伪造 IP。以后部署若需代理来源识别，必须另行配置可信代理而不能放宽当前验证。

## 审计与错误

初始化、登录、退出、改密、人格/分类保存、发布、下架、归档、恢复和版本测试追加审计。审计记录动作、对象、修订/版本关联和请求 ID，不复制密码、令牌、连接串或内核原文。审计记录不可原地修改/删除。

数据库错误统一脱敏返回 503，不转为认证成功；冲突返回 409，字段错误 400。所有管理路径（包括未知路径）先鉴权，访客身份、前端布尔值、Bearer admin 或伪造角色头都无效。后台 SSR 使用 no-store 的会话校验；退出后完整导航离开受保护空间。

测试已覆盖会话撤销/过期、改密、错误密码、伪造身份、CSRF、限流、只读角色、HTTPS Cookie 与数据库不可用。真实生产 HTTPS 代理和实体 Safari 验收尚未执行。

## 3.1 SameSite 选择

当前管理流程只有同站登录、会话确认与 API rewrite，没有第三方 OAuth/支付回跳依赖 Lax。管理员及预登录 Cookie 因此统一 Strict，不改变 HttpOnly、生产 Secure 或 Host-only 属性；Origin 与 CSRF 仍同时校验。

外站链接首次进入本站时 Strict Cookie 可能不随导航发送，受保护入口可能转登录。这不代表数据库会话失效；显式站内继续或刷新可重新携带 Cookie。真实 Chromium 回归区分跨站首次 GET 与后续同站导航，不通过放宽 CSRF 来修复该预期行为。生产跨域/自定义域名/实体 Safari 仍需在部署前验证。
