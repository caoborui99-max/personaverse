# 登录补充验收：真实浏览器结果与修复

2026-11-16，分支 `feat/v2-minimal-mobile-ui`；基线 `e2c648706fda168d97f7c13336467d10f9959a04`。仅本地、隔离数据库、模拟邮件和Fake聊天，不部署、不推送、不使用真实热土Token或收费服务。

## 验收方式与结论

本轮新增10项独立浏览器场景，实际连接编译后的Next.js、Fastify和PostgreSQL，不用API inject或伪造成功响应代替登录。专用`--login`运行器每次创建新的pv*browser*_ schema并完整迁移0001—0008，生成随机Owner账号；结束后销毁该测试schema和私有模拟邮箱。现有持续预览使用另一pv*runtime*_ schema，测试结束恢复原有预览并再次现场核验。

**三类要求均实际通过：**原生用户注册/邮箱验证/密码登录/退出/重新登录/独立设备恢复；Owner原生后台登录/发布/下架及普通用户拒绝访问管理员接口；热土关闭、无可见第三方登录入口、直接回调404，原生会话保持可用。未接入真实第三方认证。

## 两项业务问题和修复

1. **编码路径错误跳转。** 浏览器重现`/login?next=/%61dmin`在登录后进入编码的管理路径/错误地址。原有过滤只检查编码前的pathname，未正确识别编码后的admin路径。服务端管理员鉴权一直有效，没有权限升级。现在抽取纯函数，先解码及规范化路径，再拒绝管理、认证、外站、协议相对、控制字符、反斜杠和残留双重编码；畸形编码安全回退/account。正常/history及同源查询参数保留。
2. **关闭热土时仍显示未完成回调。** 绑定API原来已503拒绝，但直接访问回调页仍200显示Mock界面。新增只读公开能力接口`GET /api/v1/auth/rengine/capabilities`，仅返回enabled/mode，不含用户信息、软件ID或凭据；回调页面按服务端能力判定，关闭或能力查询失败时404。采用force-dynamic及no-store，防止构建/缓存保留开启状态。回调初次GET不要求Strict会话Cookie；真正绑定的同源POST仍沿用原鉴权、Origin与CSRF，不新增豁免。

显式启用的隔离Mock绑定场景仍在Node/Workers浏览器通过；实际持续预览及新登录专项始终关闭热土。Workers增加关闭能力/回调404检查，避免只验证Node。

## 10项浏览器证据

| 场景              | 实际验证                                                                                                                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 Owner          | UI密码登录后GET服务端会话确认owner；管理员Cookie与用户Cookie独立；保存明确TEST ONLY原文、发布成功、下架后404、再次发布；退出后管理员会话401。                                                                              |
| 02 普通用户全链路 | UI注册并确认未登录；验证前密码登录失败；从本地私有测试邮箱取得验证链接，验证后UI登录；写入Fake聊天、退出清Cookie并确认数据库撤销，重放旧Cookie仍被浏览器访问拒绝；重新密码登录，另建BrowserContext登录恢复同ID历史及刷新。 |
| 03 CSRF           | 浏览器fetch对真实接口发送缺失/错误/另一会话CSRF均403；同一页面正常资料表单保存成功；匿名缺少预登录CSRF的密码请求403且不会登录。                                                                                            |
| 04 密码重置       | UI忘记密码，私有模拟邮箱取得真实测试投递链接；UI重置撤销两个设备会话；旧密码失败、新密码成功；已过期和已使用重置票据拒绝，不再次改变密码。                                                                                 |
| 05 用户过期       | 浏览器带仍未过期的客户端Cookie访问已空闲过期/绝对过期的服务端会话，均401并跳转用户登录；随后正常密码登录恢复。                                                                                                             |
| 06 管理员过期     | 浏览器访问空闲/绝对过期Owner会话均重定向/admin/login，管理员API401，也不会获得普通用户身份。                                                                                                                               |
| 07 跳转           | 外站、协议相对、明文admin及编码admin均回退/account；合法/history正确跳转。                                                                                                                                                 |
| 08 热土关闭       | enabled=false、mode=disabled；无Mock绑定入口，start拒绝EXTERNAL_AUTH_DISABLED；直接回调404，不执行finalize，不创建外部身份或事务；返回原生个人中心会话ID不变。                                                             |
| 09 隔离           | 用户C不能读或删用户A聊天，均404；普通用户访问管理员GET/POST均401，进入后台只能到管理员登录，原普通用户会话继续有效。                                                                                                       |
| 10 跨站           | 本地合成攻击页面链接访问会话，实际浏览器请求不带Strict Cookie并401；跨站表单POST403且错误码ORIGIN_REJECTED；再主动站内导航，原合法会话仍有效，没有被攻击退出。                                                             |

每项均无未捕获浏览器异常、无意外外部网络请求。预期400/401/403/404/503按攻击/过期场景检查并记录，不冒充正常请求成功。攻击页面只在Playwright本地fulfill静态HTML，认证业务API从不fulfill；没有实际访问攻击站点或外部认证服务。

## Cookie、过期和邮件测试边界

真实密码登录后检查HttpOnly、SameSite=Strict、Path=/、回环域、Cookie不被document.cookie读取；普通用户登录响应确认无Domain属性。数据库只存会话摘要，退出后的旧令牌拒绝。当前是明确隔离的HTTP环境，Secure=false符合本地策略；生产HTTPS/Secure约束未降低，但不能将本轮HTTP浏览器结果当作生产HTTPS验收。

没有缩短或改写系统TTL：用户7天绝对/24小时空闲，管理员12小时绝对/30分钟空闲均保留。过期负向场景在严格校验的全新测试schema创建已经过期的数据库记录，Cookie自身保持未来到期以确认是服务端拒绝；这不是伪造成功登录，所有成功登录都经过实际密码表单和服务端确认。没有修改不可变历史或禁用约束。验证、重置的有效票据只从700测试目录下600文件读取，测试后清理，HTTP没有公开读信接口。额外构造的过期票据仅用于拒绝测试，未声称它曾真实发送。

注册/忘记密码UI及断言明确要求“本地模拟环境不会发送真实邮件”。本轮不接SMTP或其他邮件服务，不用真实用户邮箱。

## 测试过程中的失败

- 初次6通过、1失败、3串行后续未执行：编码next路径问题。
- 修复后7通过、1失败、2后续未执行：关闭后的回调页面仍200。
- 两项修复后9通过、1失败：合成攻击页面未声明UTF-8，中文链接乱码，点击未发生，导致等待超时。浏览器trace和截图确认是fixture编码问题；修正Content-Type及meta charset后，保留原Cookie/Origin断言，没有固定等待、跳过、降级或更改安全策略。该同类超时在定位前重复出现过。
- 最终10通过、0失败、0跳过。没有删除测试。此前中间失败未被当作通过。

## 本轮独立全量回归

| 范围                   | 通过 | 最终失败 | TODO |
| ---------------------- | ---: | -------: | ---: |
| Node单元/契约          |   44 |        0 |    3 |
| PostgreSQL数据库       |  123 |        0 |    0 |
| 原有公开浏览器         |   11 |        0 |    0 |
| 原有管理员浏览器       |    5 |        0 |    0 |
| 原有用户浏览器         |    5 |        0 |    0 |
| 新登录浏览器专项       |   10 |        0 |    0 |
| 持续预览完整浏览器流程 |    7 |        0 |    0 |
| Workers API具体用例    |   33 |        0 |    0 |
| Workers浏览器          |   10 |        0 |    0 |

Node205、Workers43，合计248个具体用例通过；0最终失败，3原有TODO，无其他最终跳过。Workers的Vitest包装输出35（33API+2个浏览器包装），展开浏览器10项后43，不双计。重复运行不重复计数。

TypeScript、Workers类型、格式、API/Next构建、OpenNext目标构建通过。0001—0008迁移未修改，在隔离库重放及Prisma一致性通过；恢复后的preview:verify再次检查全部迁移checksum、聊天归属、删除后零消息、注销会话撤销、原文保留及AI预算关闭。

3个TODO仍是实际AI、生产HTTPS/真实iPhone Safari、加密备份完整恢复；本轮不能宣称生产上线或这些检查已完成。

## 复现与持续预览

```sh
cd v2
# 已存在的持续预览先停止，让出固定的本地测试端口；不会删除其数据库。
pnpm preview:stop
pnpm build
PV_CHROMIUM_PATH=/usr/bin/chromium pnpm test:login:e2e
# 验收后恢复原持续预览：
pnpm preview:start
pnpm preview:status
pnpm preview:verify
```

首次初始化、全量命令及私有测试凭据位置见local-runtime-validation.md。专项浏览器报告：playwright-report/login-results.json；脱敏诊断及截图：.local-preview/login-evidence/。原始失败trace可能含本地测试密码，不作公开附件、不提交仓库。

持续预览仍为当前环境回环地址：前端http://127.0.0.1:4310，API http://127.0.0.1:4311/api/v1/health，管理员/admin/login。完成后保留运行。没有推送、部署或操作main、备份、腾讯云、生产库；没有使用暴露的热土Token或调用收费服务。

## 文件清单

共 14 个文件，全部位于v2/。

- `v2/apps/api/src/external-auth.ts`
- `v2/apps/web/src/app/auth/rengine/callback/page.tsx`
- `v2/apps/web/src/components/user-auth.tsx`
- `v2/apps/web/src/lib/server-api.ts`
- `v2/apps/web/src/lib/user-destination.ts`
- `v2/docs/local-runtime-validation.md`
- `v2/docs/login-browser-acceptance.md`
- `v2/package.json`
- `v2/playwright.login.config.ts`
- `v2/scripts/database-browser.ts`
- `v2/tests/database/external-auth.test.ts`
- `v2/tests/e2e-login/login.spec.ts`
- `v2/tests/integration/user-destination.test.ts`
- `v2/tests/workers/runtime.test.ts`
