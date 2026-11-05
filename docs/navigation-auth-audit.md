# PersonaVerse 导航与认证代码审查

范围：`536b434` 主站HTML、`js/app.js`、`js/admin.js`、`js/soul-admin.js`、`js/demo.js`、`server/auth.js`、`server/chat-access.js`、`server/security.js`、`server/deployment.js` 与 `api/index.js`。没有访问任何运行站点，也没有读取Cloudflare Access配置、网络日志或浏览器Cookie值。

## 已确认的代码事实与修复

1. 原后台 `admin.js` 与 `soul-admin.js` 使用 `/api/...`，前台/聊天使用 `./api/...`。根目录运行时二者等价；页面位于 `/personaverse/` 等子路径时，后台请求会落到域名根目录，前台落到子路径。如果这些路径由不同Access应用/策略保护，会出现额外认证或请求失败的条件。已统一主站为相对API路径，并增加根目录/子路径URL解析测试。
2. 原fetch默认跟随重定向且直接解析JSON。认证网关如返回登录重定向或HTML，可能产生CORS失败或JSON解析错误；原代码没有清楚区分这些情况。新增 `js/http.js`，固定同源Cookie与请求模式、禁止fetch跟随重定向、拒绝非JSON结果并显示脱敏错误。每次只请求一次，不自动重新登录、刷新或重试。
3. 页面链接保持相对路径，未引入外域导航。统一加载HTTP辅助脚本后再执行页面脚本；历史静态发布产物保持不变，静态生成器会排除这个仅主站需要的辅助脚本。

## 未发现、尚不能认定的事项

- 原代码未发现自动跳转到Cloudflare登录页、认证失败后反复刷新、Cookie轮询或Cloudflare Access令牌改写。`history.replaceState` 仅用于筛选/收藏URL，不是认证重定向。
- 原API自身返回JSON错误，不生成认证302；Host/Origin校验拒绝为400/403。应用管理员Cookie `pv_session` 为HttpOnly/SameSite=Strict/Path=/，HTTPS下带Secure；访客Cookie独立为 `pv_chat_session`、Path=/api/ai。应用不读取、清除或覆盖Cloudflare的Access Cookie。本轮没有放宽这些Cookie属性。
- SameSite=Strict在跨站返回的部分请求中可能影响应用登录态，但是否发生必须有实际请求链证明。不能据此推定Cloudflare自身认证循环，更不能未经证据归因Safari。
- 当前后端路由与访客Cookie路径仍按根目录设计。统一前端相对路径不等于已实现完整子路径托管；若采用子路径，还需独立验证路径重写和Cookie Path。

## 结论与后续证据

已修复有代码证据的路径不一致和认证响应处理缺陷。**目前不能确认它们是任何现网站Cloudflare Access反复认证的实际根因，也没有证据认定Safari导致。**

将来若仍有问题，需要一次脱敏的重定向请求链：页面与API实际host/path、状态码和Location指向、各路径匹配的Access应用/策略、Cookie作用域与有效期、请求Host/Origin/X-Forwarded-Proto是否一致。不要收集Cookie值、JWT、Authorization、密码或API Key。此项不要求本轮连接站点。

离线测试覆盖：根目录/子路径API解析、同源Cookie选项、拒绝跨域API、阻止重定向、HTML登录响应与网络失败只处理一次、脚本加载顺序。真实Cloudflare和实体iPhone行为尚未验收。
