# 生产候选本地验收记录

2026-11-17，feat/v2-minimal-mobile-ui。保留并合并远程555fe83、5d16f16的DeepSeek模块及测试，沿用其导出接口，强化有界读取和生产严格响应校验。当前提交SHA见Git历史，避免在提交内自引用。

| 检查                                      | 最终结果                                                       |
| ----------------------------------------- | -------------------------------------------------------------- |
| pnpm typecheck（API/共享/Web）            | 通过                                                           |
| pnpm cf:typecheck（含独立生产及Mock入口） | 通过                                                           |
| pnpm test                                 | 82通过，3原有TODO；1个原有TODO文件跳过                         |
| pnpm test:database                        | 147通过，独立回环PostgreSQL随机schema，包含0010迁移            |
| DeepSeek专项数据库复测                    | 1通过，包含在147内，不重复累计                                 |
| pnpm test:e2e                             | 12通过                                                         |
| pnpm test:database:e2e                    | 5通过，创建/编辑/发布/下架、版本冲突、未保存保护、Cookie与退出 |
| pnpm test:login:e2e                       | 10通过，注册/验证/重置/会话隔离与热土关闭验证                  |
| pnpm build及最终API构建                   | 通过                                                           |
| pnpm cf:build                             | OpenNext目标构建通过                                           |
| node scripts/production-dry-run.mjs       | password/API/Web三个独立生产配置本地打包通过，没有上传         |
| pnpm format:check、git diff --check       | 通过                                                           |

浏览器使用系统Chromium；移动视口不是物理iPhone。DeepSeek/邮件传输全部使用合成响应，不调用真实DeepSeek或热土，不发送真实邮件，不连接生产数据库。本轮未执行完整Workers运行时套件、真实边缘负载或真实账单对账；dry-run不等于线上运行验收。原有3项TODO仍未作为通过项计入。

新增数据库用例直接通过已登录用户HTTP路由验证：无价格/预算不调用模型，同键并发只派发一次，重试不新增消息和额度，内容冲突与跨用户拒绝，真实账本标记及usage持久化，预算耗尽、人格下架零调用，未知结果保留预留/熔断/不自动重试，带证据人工释放。最后针对会话排序时间和返回前再校验身份的修复完成专项复测与API构建。

首次浏览器检查缺构建产物；补构建后完整重跑通过。一次并发Next/OpenNext构建发生输出目录锁竞争；改为串行构建通过。新增数据库fixture最初缺Persona ID及有效开场白，被既有SQL约束拒绝，修正合成fixture后通过，未放宽约束。格式检查期间与文件编辑发生重叠，最后串行复查通过。最终结果未把这些失败尝试计为成功。

GitHub只读核查：Pages来源为preview/static-mobile-v01:/docs，开发分支没有Actions运行，当前检出无.github/workflows。Webhook列表403，因此不能排除不可见外部集成。仅按用户要求推送开发分支，不执行Cloudflare部署、购买、资源创建或公开路由配置。生产AI默认false、全部workers_dev/preview_urls关闭，真实上线仍受production-release.md中的Secrets、数据库权限/预算、域名、Hyperdrive缓存及私有验收阻塞。

凭据审查：本轮改动文件未发现高置信度私钥/访问密钥模式；测试中只有明确合成凭据。未提交.env、数据库连接、Cookie、浏览器状态或生成产物。启发式扫描不能代替人工Secret管理。测试临时PostgreSQL由本轮创建，完成后移除；不改变用户已有数据库。
