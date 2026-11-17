# 公网封闭 Mock 适配补丁验收

日期：2026-11-17。分支 feat/v2-minimal-mobile-ui；基线663a6f2b29fcfaf85696ad41dc14fec88a5de5be。仅本地开发提交，不推送、不部署、不创建Cloudflare/Neon资源、不连接远程数据库、不调用付费模型或邮件。所有人格数据均由现有隔离测试fixture提供，未编写正式人格。

## 已实现

- 独立Web/API/SQLite DO公网测试配置，保留本地原始白名单。公网配置默认有无法使用的Origin/Hyperdrive占位符及cache确认false，不能直接发布使用。
- 唯一公开Web入口；API/密码Worker没有公网/预览地址；诊断路由不进入新入口。公开Web的构建仍复用现有OpenNext产物。
- 可信CF IP→HMAC私有桥接→服务端限流；拒绝伪造内部头；保留Origin/Cookie/CSRF；SSR仅只读内部身份。
- 封闭账号模式关闭注册及所有邮件令牌流程；真实AI/费用实验/热土provider不注入。每请求检查AI关闭、零货币预算。
- 公网API运行角色自检与独立远程测试操作工具；迁移凭据只用于受控本机，应用凭据只交Hyperdrive。交互目标确认、TLS直连、原样迁移、受限NOLOGIN角色、合成测试账号初始化；没有自动初始化/生产迁移入口。
- Hyperdrive缓存必须在远程配置中关闭；本地配置中的声明无法证明远程设置，模板默认拒绝运行，仍需后续云端门禁。

具体信任边界、目标校验、控制台准备、Secret配置及撤销见[操作说明](mock-preview-preparation.md)。

## 本轮实际运行结果

| 验证                              | 命令                                                                        | 最终结果                                         |
| --------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------ |
| Node 契约/单元                    | pnpm test                                                                   | 70通过，0失败，3 TODO                            |
| 隔离PostgreSQL                    | pnpm test:database                                                          | 146通过，0失败                                   |
| workerd及Workers浏览器套件        | pnpm test:workers                                                           | 46通过，0失败                                    |
| 新入口HTTPS强化复测               | vitest --config vitest.workers.config.ts tests/workers/mock-preview.test.ts | 2通过，0失败（以上46项中的用例复测，不重复计数） |
| 独立Node浏览器：原有公开/20轮Mock | pnpm test:e2e                                                               | 12通过，0失败                                    |
| 独立Node浏览器：后台              | pnpm test:database:e2e                                                      | 5通过，0失败                                     |
| 独立Node浏览器：用户/跨设备/收藏  | pnpm test:users:e2e                                                         | 6通过，0失败                                     |
| 独立Node浏览器：完整登录安全      | pnpm test:login:e2e                                                         | 10通过，0失败                                    |
| TypeScript（API/Web/Workers）     | pnpm typecheck; pnpm cf:typecheck                                           | 通过                                             |
| 格式                              | pnpm format:check                                                           | 通过                                             |
| API与Next构建                     | pnpm build                                                                  | 通过                                             |
| OpenNext目标构建                  | pnpm cf:build                                                               | 通过                                             |
| 独立迁移重放后drift               | 新建隔离schema，原样迁移，再执行scripts/database.mjs diff                   | exit 0                                           |

统计口径：262项Vitest通过、33项独立Node浏览器通过，共295项；3项原有TODO保留。Workers套件还实际启动11项嵌套Playwright浏览器测试（6用户+5后台），其包装用例已包含在46中，不再叠加到总数。HTTPS Firefox测试直接计入46项，不使用ignoreHTTPSErrors，信任隔离CA。浏览器是本机模拟移动视口，不能代表实体iPhone。

新增测试覆盖：Origin端口校验，诊断编码变体，HMAC被篡改/过期/目标更换，可信IP与伪造转发，SSR写拒绝，邮件页面关闭，迁移目标拒绝，角色权限判定，真实PG应用角色拒绝DDL/TRUNCATE/禁用触发器/预算修改/审计删除及事务回滚，封闭模式原生用户/Owner HTTPS登录及退出撤销，真实新API在workerd中通过HTTPS返回诊断404、错误来源503、正确来源无证明403。工作流初始化脚本的远程TTY操作未执行。

## 失败记录与修复

- 新Origin测试发现非标准端口未拒绝；增加端口校验后通过，保留原断言。
- 初次Workers运行缺Playwright浏览器；安装后出现磁盘不足。仅清理可重建构建缓存及本轮多余浏览器下载后重跑，未改测试安全断言。
- 新Miniflare测试最初按旧API配置、且手动esbuild缺Wrangler的Prisma/WASM处理：改用锁定Miniflare的官方V4配置转换和实际Wrangler local启动新API。未删除测试或替换业务实现为mock。
- 新私有入口fixture最初缺Hyperdrive密码，后漏了将cache声明由默认false显式置为true。修正隔离fixture；公网配置继续默认false。
- 独立Node E2E初次因已有V2本地预览端口占用未能启动；通过项目所属进程记录确认、停止再运行，完成后恢复预览。未复用旧服务冒充测试fixture。
- 本地HTTPS测试使用IP TLS servername，Node发出弃用告警；证书/CA校验保持开启。OpenNext提示代理环境变量，不作为云端运行成功证据。

## 未验证与剩余阻断

本地测试不等于线上Free CPU验收。没有创建真实DO/Hyperdrive或托管PG；云端CPU/内存、TLS与事务池、真实缓存关闭、运行角色和完整公网Web→API→数据库链路仍须单独授权验证。当前完整浏览器链路使用保留的本地适配器和真实私有密码DO，本轮另验证公网入口边界；不能将其表述为完整公网配置已在云端通过。

原有3 TODO：真实DeepSeek流式/计费集成；生产HTTPS/实体iPhone；加密备份与完整恢复演练。另有本轮发布门禁及SQL/日额度、心跳存储增长风险，见操作说明。不开启自动付费或自动重试跨过门禁。

没有修改0001—0009历史迁移，没有改变main/备份分支，没有真实邮件/模型调用。未把私有环境文件、密码、Secret、证书、浏览器状态、日志或数据库产物纳入提交。

## 本轮变更文件

- `v2/.gitignore`
- `v2/apps/api/src/database-routes.ts`
- `v2/apps/api/src/fetch-app.ts`
- `v2/apps/web/src/lib/server-api.ts`
- `v2/cloudflare/api-worker.ts`
- `v2/cloudflare/mock-preview/api.jsonc`
- `v2/cloudflare/mock-preview/api.ts`
- `v2/cloudflare/mock-preview/gateway.ts`
- `v2/cloudflare/mock-preview/password.jsonc`
- `v2/cloudflare/mock-preview/policy.ts`
- `v2/cloudflare/mock-preview/web.jsonc`
- `v2/cloudflare/mock-preview/web.ts`
- `v2/docs/mock-preview-patch-status.md`
- `v2/docs/mock-preview-preparation.md`
- `v2/package.json`
- `v2/packages/api-client/src/private-bridge.ts`
- `v2/scripts/cf-local.mjs`
- `v2/scripts/mock-preview-database.ts`
- `v2/tests/database/harness.ts`
- `v2/tests/database/mock-preview.test.ts`
- `v2/tests/integration/mock-preview.test.ts`
- `v2/tests/workers/closed-preview-browser.test.ts`
- `v2/tests/workers/harness.ts`
- `v2/tests/workers/mock-preview.test.ts`
