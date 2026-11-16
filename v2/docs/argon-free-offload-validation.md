# Argon2id 免费计算拆分：本地验证与剩余验收

2026-11-16；基线 `c7f6dd77876b13881752955831b267195471e261`；分支 `feat/v2-minimal-mobile-ui`。仅修改v2，仅创建本地提交。没有Cloudflare账号操作、远程资源、部署、推送、收费模型或真实邮件。

**推荐候选：普通API Worker通过私有Durable Object命名空间RPC调用独立密码Worker中的Argon2id对象。** 本地真实运行已成功分离密码计算；保留Native Node入口、现有PHC、全部认证和PostgreSQL业务数据。**不宣称完整网站在Workers Free上稳定运行已经通过。** 免费账号的实际CPU约束、调用方剩余CPU、配额和生产网络仍未做云端验收。

## 官方规则与适用范围

本轮重新读取以下官方文档，不把另一种计划或示例配置当成免费额度：

- [Workers限制](https://developers.cloudflare.com/workers/platform/limits/)：Free普通HTTP请求10ms活跃CPU、128MB/isolate、100,000请求/日。I/O等待不计CPU；请求墙钟耗时不是CPU。偶尔超限的弹性不能用作稳定容量。设置`limits.cpu_ms`提高CPU是Paid功能，不是免费解锁开关。该页的超限建议包括向Durable Objects转移计算。
- [Durable Objects限制](https://developers.cloudflare.com/durable-objects/platform/limits/)：SQLite-backed表中CPU默认30秒、可配置到5分钟；同页也有“same per invocation CPU limits as any Workers”的概括表述。不能仅凭“Free能使用DO”就声称已经在Free账号验证了30秒CPU。下一步须向Cloudflare确认适用规则，并实际查看该账号的执行结果。当前不设置高于Free普通Worker额度的`limits.cpu_ms`，不借本地运行时无配额限制冒充云端通过。
- [Durable Objects价格](https://developers.cloudflare.com/durable-objects/platform/pricing/)：Free只允许SQLite-backed类，100,000请求/日、13,000GB-s/日，配额耗尽后相应操作失败，00:00UTC重置；Paid另计费。DO按活跃墙钟时长和分配的128MB计duration，不是按实际只用了19MiB计费。一次独立RPC调用计一个请求，密码修改的验证与新哈希是两次调用。
- [Worker Service Binding价格](https://developers.cloudflare.com/workers/platform/pricing/#service-bindings)：普通Worker之间的Service Binding不增加请求费，但CPU按双方总量计。不能把原函数搬到另一个普通Free Worker就认定96ms问题消失。新方案使用DO独立运行模型，不以普通Worker拆分规避限制。
- [DO RPC](https://developers.cloudflare.com/durable-objects/best-practices/create-durable-object-stubs-and-send-requests/)：使用私有命名空间和异步RPC，类继承`DurableObject`；本仓库compatibility_date为2026-11-13。

`waitUntil`、定时器、异步包装、把哈希拆成多个公开步骤，都不能证明同一普通Worker请求的密码CPU合格。本轮未把哈希移到浏览器，也没有改用快速哈希或改动Argon2id安全参数。

## 方案比较

| 方案                                             | 稳定性/安全                                                                                                                                                                                     | 运维及费用                                                                                                           | 决定                                         |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Free普通Worker内联Argon2id                       | 本地原门禁超10ms；登录、注册等受影响                                                                                                                                                            | 简单但资源不满足；调大配置不是免费方案                                                                               | 保留失败基准，不采用此路径解决问题           |
| Free SQLite-backed DO私有RPC                     | 同一运营者、服务端能力绑定；无需把密码交给另一个厂商；不自动保存密码                                                                                                                            | 配额内官方有Free计划；增加一个私有Worker/DO类；云端CPU规则和容量待验证                                               | 最有希望，已实现本地候选                     |
| [Render Free Node](https://render.com/docs/free) | Native Argon可保留；15分钟无请求休眠，冷启动约1分钟，不适合宣称稳定生产；额外HTTPS认证边界要审计                                                                                                | 每工作区750小时/月；无付款方式时带宽超额会暂停、构建超额会禁用新构建，有付款方式可能产生附加费用；官方建议不用于生产 | 可作低流量测试候选；本轮未创建实例、未接入   |
| 自有独立主机运行Node                             | 本地Node已验证；可保留全部认证；依赖机器、网络、备份和维护                                                                                                                                      | 无新增托管订阅不等于没有硬件/电力成本；不能使用旧腾讯云服务器                                                        | 备用演示路线，不是已验证的全托管零成本云方案 |
| 云平台试用或免费额度                             | 如[Cloud Run](https://cloud.google.com/run/pricing)存在免费额度，但需另审账单账号、超额费用及许可；[Oracle Free](https://www.oracle.com/cloud/free/)需核对Always Free与试用、账号资格和可用容量 | 未授权账号、未创建资源，不能用“有免费额度”承诺零费用                                                                 | 未验证，不引入                               |

推荐DO的依据是官方免费可用性、无需新增外部信任方、现有静态WASM已运行，以及本轮实际认证回归。它是待云端验收的候选，不是已经取得免费账号额度证明。

## 真实执行路径与影响接口

Node仍为`auth.ts → @node-rs/argon2 2.2.2`。Workers改为：

```text
浏览器HTTPS
  → OpenNext Web
  → 私有API Service Binding（Cookie/Origin/CSRF、DB限流与权限）
  → auth.ts → 构建期@node-rs/argon2别名argon-rpc.ts
  → request-scoped AsyncLocalStorage中的PASSWORD_HASHERS
  → 独立password Worker内的PasswordHasher Durable Object
  → 原有hash-wasm 4.13.0静态Argon2id WASM
```

固定`m=19456KiB,t=2,p=1`、随机16字节盐、32字节输出和v19 PHC。`argon-policy.ts`只包含参数与结构校验，不导入WASM。旧`argon-wasm.ts`只是复用该策略，密码算法、已审查源码转换器和二进制校验均不变。Node生成→DO验证，以及DO生成→Node验证均由真实用例验证。

受影响的密码计算入口：普通用户注册/登录（不存在账号也做一次假负载哈希）、密码重置/修改、账号注销前密码确认；管理员登录和密码修改。热土绑定的密码复核若在显式Mock套件启用，也走同一策略；网站默认仍关闭热土。普通会话查询、退出、邮件令牌验证和忘记密码申请本身不做Argon2id，随机会话/邮件令牌继续使用摘要，未把密码改成摘要算法。

DB身份与授权仍由API决定；DO不接收用户ID、角色、会话、数据库连接或人格内核，只返回结构受限的PHC/布尔结果。登录完成前仍在数据库事务内重新确认原密码哈希及authVersion，不能凭DO回复直接创建前端登录状态。

## 安全边界与失败关闭

- `PasswordHasher`只提供`hash`/`verify` RPC；实现辅助方法为JS真正私有`#perform`，默认HTTP入口固定404。三个Worker的`workers_dev`、preview URL继续关闭。
- Free要求的`new_sqlite_classes`只登记密码DO类。本地创建的是Miniflare/workerd隔离状态；没有D1资源，也没有把PostgreSQL业务表迁到SQLite。DO代码没有任何storage写入，不保存密码或PHC。JS/WASM内存不能保证调用后即时清零，因此禁止内存转储、参数跟踪和敏感日志；不作“立即擦除”的虚假保证。
- 一个固定对象名`passwords-v1`，不按邮箱或用户生成对象，不用无限分片绕开额度。原有单isolate最多两个内存哈希保护保留；单对象吞吐量和突发排队需云端实测。原数据库持久限流仍在调用密码服务前执行。
- RPC绑定通过AsyncLocalStorage按请求隔离，不使用全局可变env。输入、PHC参数及返回类型均校验；忙时429、绑定缺失/超时/错误响应503。错误响应不包含密码、PHC或RPC异常正文。
- 超时5秒，无自动重试、无API内联哈希降级。超时不保证已经停止DO中的运算；不得用断网描述为“不消耗计算”。服务失败不建立会话、不创建半成品用户。普通用户密码验证现在传播安全的503服务错误，避免把服务中断误报为错误密码。
- 已登录用户的会话读取和退出不依赖密码计算，服务中断不授予新权限。管理员、普通用户及匿名历史隔离、费用账本与人格版本均维持原约束。

## 本轮实际修复的浏览器与测试工具问题

扩展HTTPS回归时发现后台退出按钮在SSR HTML中已经启用，而客户端脚本尚未就绪时点击可能丢失。通过拦截并延后后台脚本下载，**先在旧代码上观察到“预期disabled，实际enabled”的失败**。现在按钮在React就绪前禁用；恢复脚本后点击，测试要求真正收到退出API 200、页面跳转且服务端会话401，未放宽安全断言。

故障注入需要重载本地配置：原`writeFileSync`截断文件会让Wrangler偶尔解析到空JSON。原子rename尝试又暴露了Wrangler 4.161对被替换inode的后续变更监听丢失。最终使用小型预分配4096字节配置，同inode、同长度的一次写入，不先截断或替换；运行时确认必须同时匹配代次和实际转发的Origin状态。没有固定等待假装重载完成。此配置仅用于本地实验，不是生产环境热改密钥机制。

早期上述失败日志保留在被忽略的本地目录，最终全量回归单独记录，不删除测试、跳过失败断言或把诊断轮次加到通过总数。

## 测量方法与不能证明的事情

1. 原`cf:bench:argon --require-free-cpu`完整保留：Linux独立workerd每线程`schedstat`增量求和，测的是内联算法的CPU估计。仍有10ms严格门禁；它失败不能改写成通过。
2. 新`cf:bench:password-object`运行两个独立isolate、真实SQLite-backed DO RPC、真实WASM，没有数据库或真实凭据。构建元数据要求调用方不包含`hash-wasm`、`argon-wasm`、密码类或WASM输入；Profiler要求调用方无WASM样本、密码对象有WASM样本。
3. 本轮采样：hash调用方27样本/WASM0，密码对象5966样本/WASM5875；verify调用方29/WASM0，密码对象5169/WASM5111。每条路径实际调用12次，预热后采样。它证明计算位置，不证明调用方耗时少于10ms。
4. **不能将V8的`timeDeltas`之和当成CPU毫秒。** 等待DO时isolate暂停采样，后续样本的delta可能覆盖整个await空档。本轮识别并去掉了这种错误推算；最终工具输出样本数和墙钟区间，明确`hostedFreeCpuVerified:false`。也不把普通`performance.now()`或整个进程RSS当作CPU/isolate内存验收。
5. API剩余的Prisma查询编译、Zod、审计、Cookie和Web SSR仍消耗CPU。本地workerd不执行云端Free限额；没有条件据此保证所有路径低于10ms或128MB。必须在后续获准的真实Free账号中验证。

本轮重跑原门禁退出2：健康检查CPU中位数0.256ms，内联hash **99.336ms**、verify **93.249ms**，`freeCpuFitsLocally:false`。密码计算没有变快，已经移到独立DO。最终实际Wrangler产物中，API仅包含Prisma查询编译器WASM，没有Argon2/BLAKE2b WASM；API总计3,481,305 bytes，密码Worker含静态WASM共67,963 bytes，Web为5,848,531 bytes（均不含source map）。这证明打包职责分离，不证明调用方CPU合格。

## 本轮测试与复现

以下为本轮独立执行的最终结果，不沿用上一轮255项数字。Linux、Node24.22.1、pnpm11.25.0、workerd1.20261110.1；所有测试邮箱为`test.invalid`、密码随机生成，邮箱证明只来自隔离本地邮件目录。PG为本地带归属标签的PostgreSQL16容器，各套件使用随机schema，真实重放0001—0008；没有改变历史迁移、Prisma模型、作者正式内容或账本。

| 套件                 |    通过 | 最终失败 |  TODO | 证据                                                                                                           |
| -------------------- | ------: | -------: | ----: | -------------------------------------------------------------------------------------------------------------- |
| Node单元/契约        |      53 |        0 |     3 | 原44项保留，新增9项RPC校验、请求隔离、503/429、超时、错误脱敏与不重试                                          |
| Node PostgreSQL/API  |     123 |        0 |     0 | 全部8迁移、模型一致性、约束、认证、归属/版本、事务、预算账本                                                   |
| Node浏览器           |      38 |        0 |     0 | 公开11、管理员5、用户5、原生登录10、常驻运行7；包含20轮、跨设备、CSRF及角色隔离                                |
| Workers API          |      33 |        0 |     0 | 真正通过DO密码路径；含Unicode/长密码、并发、改密、会话、故障与PG回滚                                           |
| Workers原浏览器      |      10 |        0 |     0 | 管理员5、用户5；显式Mock第三方回归不含真实请求                                                                 |
| Workers HTTPS浏览器  |       8 |        0 |     0 | 原7项保留并强化退出就绪检查；新增私有绑定缺失时注册/用户登录/管理员登录503，账户和会话数量不变，恢复后登录成功 |
| **功能合计**         | **265** |    **0** | **3** | Node214+Workers51；Workers外层43项含2个各5例包装，按43−2+10=51展开，未重复计数                                 |
| 内联Free CPU参考门禁 |       0 |    **1** |     0 | exit2，未删除、降低或改判                                                                                      |

TypeScript、Workers TypeScript、Fastify/Next构建、OpenNext构建及格式检查均通过。新增执行位置诊断通过；它不是Free CPU门禁。3个原TODO保留：真实DeepSeek集成、生产HTTPS/物理iPhone、加密备份恢复；本轮免费账号CPU、128MB峰值及配额耗尽是额外未执行的云端验收，不混成通过。

早期轮次真实出现过配置截断/替换inode丢失监听，以及退出按钮未就绪，最终修复后重新执行全量，未删改失败断言。用于证明退出缺陷的“延后脚本、预期按钮禁用”负向对照在旧代码上明确失败；新代码中释放脚本后要求真实退出响应及会话撤销。

```sh
cd v2
pnpm preview:stop
# 先按README准备隔离PG与依赖；不对已有预览数据库清空数据。
pnpm db:generate
pnpm cf:client
pnpm typecheck
pnpm cf:typecheck
pnpm test
pnpm test:database
pnpm build
pnpm cf:build
pnpm test:workers
pnpm test:e2e
pnpm test:database:e2e
pnpm test:users:e2e
pnpm test:login:e2e
pnpm preview:start
pnpm test:runtime:e2e
pnpm cf:bench:password-object
# 下列内联基准仍预期在本机不满足10ms，明确保留退出2。
pnpm cf:bench:argon --require-free-cpu
pnpm format:check
```

HTTPS回归依赖OpenSSL、NSS certutil、Playwright Firefox；只在临时Firefox配置中信任短期本地CA，不绕过证书验证。完整命令日志位于被忽略的`.local-preview/password-object-validation/`。物理iPhone Safari、云端HTTPS和免费账号执行上限仍未验证。

脱敏证据导出到`/workspace/artifacts/personaverse-password-offload/`：`placement.json`、`inline-reference.json`、`bundles.json`、`https-browser.png`和`results.json`。不导出邮件、Cookie、浏览器存储、证书私钥、数据库URL或原始trace。Node预览已恢复到回环4310/4311；Workers测试进程已结束，热土默认关闭、聊天为明确Fake模式。

## 变更范围

所有修改限定v2。新增：`cloudflare/argon-policy.ts`、`cloudflare/argon-rpc.ts`、`cloudflare/password-worker.ts`、`cloudflare/password/wrangler.jsonc`、`cloudflare/password-benchmark.ts`、`scripts/benchmark-password-object.mjs`、`tests/integration/argon-rpc.test.ts`及本报告。

修改：`cloudflare/argon-wasm.ts`、`cloudflare/api-worker.ts`、`cloudflare/api/wrangler.jsonc`、`cloudflare/runtime.d.ts`、`scripts/cf-local.mjs`、`tests/workers/harness.ts`、`tests/workers/https-browser.test.ts`、`apps/api/src/user-auth.ts`、`apps/web/src/components/admin-workspace.tsx`、`package.json`、`README.md`、`docs/cloudflare-free-readiness.md`。共20文件。依赖锁文件、已审查WASM生成器、原内联CPU门禁及0001—0008迁移均未修改。

## 需要站长后续确认的操作

本轮无需提供Token或购买服务。后续先审核方案及文档中的DO CPU适用疑问，确认账号确为Workers Free而非Paid，并取得Cloudflare对该账号规则的确认。只有另行明确批准后，才创建SQLite-backed密码DO命名空间、私有绑定和受控公网测试站，验证实际CPU、错误1102、内存、并发、duration/请求额度及配额耗尽时的503处理。

专用托管PostgreSQL、Hyperdrive缓存禁用/最小权限/恢复演练、正式邮件、Web/API剩余CPU与iPhone/国内网络是原有独立上线条件。DO不提供PostgreSQL，不解决免费PG休眠和容量限制，也不证明网站可以全天候免费稳定运行。不能直接发布本地测试数据库入口或邮件测试能力。

**当前判定：本地密码计算拆分可用；免费云端CPU阻断尚未完成验证，不宣称彻底解决。**
