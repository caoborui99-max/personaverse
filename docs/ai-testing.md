# 第二阶段最小 AI 测试接口（默认关闭）

## 边界

新增 OpenAI Chat Completions 兼容 Provider，默认不发起真实调用。当前仅允许已登录管理员测试，不开放匿名/普通用户收费调用。没有支付、会员或公开生产部署。本实现没有声称真实 Token Rhythm 请求已成功。

## 配置

所有配置仅在服务端；不要使用 NEXT_PUBLIC_/VITE_ 前缀。

|变量|配置|
|---|---|
|AI_ENABLED|默认 false；只有精确字符串 true 才可能发起调用|
|AI_BASE_URL|https://tokenrhythm.studio/v1；实际请求路径追加 /chat/completions|
|AI_MODEL|从 Token Rhythm 控制台/官方文档复制准确模型 ID，不是显示名称；当前不猜测、不设置默认模型|
|AI_API_KEY|仅服务端敏感环境变量；不要粘贴到聊天、Git或前端|
|AI_DAILY_LIMIT|全站 UTC 自然日调用尝试额度，默认5，最大20；首次建议1|
|AI_RATE_LIMIT|每管理员每UTC分钟默认2，最大10；首次建议1|

消息最多1000字符；输出固定 max_tokens=256；20秒超时；上下文保留最近6条消息、每条最多2000字符，并从数据库加入受限长度的人格设定。每个会话最多保存最近40条消息。所有上游响应是纯文本渲染；错误响应和密钥不会原样回传或日志输出。不自动重试，不跟随重定向。上游错误/超时可能已发生费用，因此已尝试请求仍占测试额度；请求ID不会被再次执行。额度是调用次数上限，不是金额承诺，供应商控制台也应设置预算限制。

## API

- GET /api/ai/status：仅返回模式、开关与额度，不返回密钥/地址/模型凭据。
- POST /api/ai/chat：{personaId,threadId?,message,requestId}。必须管理员登录、同源JSON；不接受客户端systemPrompt、messages或role。
- GET /api/ai/history?threadId=...：仅可读取当前管理员身份所拥有的会话。

数据库保存历史和请求去重、全站日额度、频率及并发锁。人格系统设定从数据库读取，按人格检查会话归属。系统规则与用户文本分开传入；提示词规则无法保证模型绝不受注入影响，服务端权限和数据隔离才是实际访问边界。本版本没有工具调用，不给模型访问密钥或其他会话的能力。

## 无密钥时

全局关闭或任一配置缺失时，聊天页显示“预置演示 · 非真实AI”，固定文案演示不会发起模型请求。真实模式请求失败不会降级生成假AI回复。真实模式按钮明确提示可能计费，未登录管理员不能发送。

## 首次真实调用：仅由你手动开启

当前Codex对话没有接入一个可由你直接输入秘密、且不经过聊天的密钥注入界面；本轮未保存真实密钥。不要把密钥发给助手。

你已有独立Vercel测试项目时，可在iPhone Safari操作：
1. Vercel → 测试项目 → Settings → Environment Variables。配置上述变量，先保持 AI_ENABLED=false；AI_API_KEY选择敏感值，只在该控制台输入。模型ID从Token Rhythm自己的控制台/官方文档复制。
2. 将 AI_DAILY_LIMIT=1、AI_RATE_LIMIT=1 应用到实际使用的 Preview/测试环境。不要关联正式生产项目。确认之前的 DATABASE_URL、ADMIN_EMAIL、ADMIN_PASSWORD 已配置。
3. 你准备好承担首次供应商调用费用后，再把 AI_ENABLED=true 并重新部署测试环境。本轮助手不会替你部署或开启。
4. 打开测试站 /admin.html 登录，再打开 /chat.html?id=moonlight。确认提示“真实AI测试”及可能计费后，手动发送一条短消息；可在供应商控制台核对用量。没有真实地址时这些步骤不能视为完成。
5. 完成后把 AI_ENABLED=false 并重新部署测试环境，停止进一步真实调用。

Vercel Hobby是否适用于你的用途、Token Rhythm模型是否收费/额度多少，以供应商控制台为准。配置管理员或供应商密钥无需美国手机号作为应用代码前提，但第三方账户的实际注册要求需要你自行确认。

## 本轮实际验证

- node tests/ai.test.js：5组Mock测试通过，0失败。包括默认关闭/缺失配置、管理员与输入保护、数据库人格多轮历史、幂等/每日额度、请求序列化与错误脱敏、失败不重放、并发锁与频率限制。
- node tests/mvp.test.js：5组原有集成测试通过，0失败。
- python3 -u tests/browser_smoke.py：5个原有Chromium场景通过，覆盖默认演示模式及原站功能；不等于真实iPhone或真实AI模式浏览器验收。
- npm run build：通过（最终结果见本轮交付报告）。

未验证：真实模型ID及兼容性、Token Rhythm实际请求与账单、真实Neon、Vercel Preview、实体iPhoneSafari、跨浏览器真实AI多轮页面。没有执行收费请求，不能把Mock通过称为真实供应商已验证。流式输出、普通用户登录、会话删除/重命名及完整内容审核不在本次最小接口范围；“新建会话”不会删除旧记录。
