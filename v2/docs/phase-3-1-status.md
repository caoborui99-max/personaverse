# PersonaVerse 2.0 · 3.1 安全补丁与适配评估

## 范围和基线

基线为 feat/v2-minimal-mobile-ui 的 cfb3a649757ebe6fc13d4d25a2ff0245b7322e61。开始时工作区干净，git fetch 后远程同 SHA。main 为 317a99f8510514d8b094b1630293e52db7cecb91，备份为 8bd91fc04ae7b3eab2f82040c176ea209fe46130；本轮不修改任何其他分支。

所有仓库改动限定 v2/。没有登录 Cloudflare、创建云资源、上传密钥、安装 Workers 适配器、调用模型、运行 wrangler deploy、推送、创建 PR 或部署；没有操作腾讯云、旧库、Nginx、systemd 或旧端口。

## 安全补丁前后

| 项目          | 补丁前                                                                     | 补丁后                                                                                                               |
| ------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 聊天归属      | 外键/所有者 CHECK 可保证引用有效，但有效的新版本/新所有者仍可被直接 UPDATE | 数据库 null-safe 四字段不可变触发器，拒绝 personaId/coreVersionId/adminId/visitorId 变化；允许 status/updatedAt 更新 |
| 发布状态      | 通用保存字段白名单已保护 API，但缺少 DB 发布流程意图与快照完整性保护       | 新增发布指针对、状态/slug CHECK、发布快照校验、事务局部意图 guard，通用 ORM 无意图写入被拒绝                         |
| 发布版本      | 仅 expectedRevision                                                        | 同时必需 expectedRevision 与 expectedVersionId，发布与页面确认版本绑定；缺字段 400，版本/修订冲突 409                |
| 编辑器        | dirty/busy 主要依赖渲染状态禁用按钮                                        | 操作函数也检查同步 dirty ref，保存/发布/分类操作互斥；请求期间冻结编辑，旧响应不能覆盖后续原文；显示将发布的版本号   |
| 管理员 Cookie | SameSite=Lax                                                               | 管理员和预登录均 Strict；保留 HttpOnly、HTTPS Secure、Host-only、Origin、CSRF 和独立访客身份                         |
| DB 错误       | 新约束错误可能被误报为数据库不可用                                         | 完整性拒绝与缺少发布意图返回 409；真正连接异常仍为 503                                                               |

没有 trim、润色、自动补全或覆盖人格内核原文。空白草稿仍可保存，缺必要字段的版本不能发布。恢复继续追加新版本，已发布快照与草稿分离，已有聊天不随新发布版本改变。

## 0004 SQL 迁移

仅新增 `database/migrations/0004_immutable_chat_publication/migration.sql`；0001–0003 内容和校验和不变，不自动运行迁移。

- `immutable_chat_binding`：BEFORE UPDATE 比较四个归属字段，使用 IS DISTINCT FROM 正确处理 NULL 与管理员/访客切换。
- `published_pointer_pair`：版本指针和 slug 同时为空或同时存在。
- `published_slug_required` / `published_slug_format`：发布态必须有双指针，slug 符合有效页面标识格式。
- `pv_publication_snapshot_valid`：发布版本属于本人格，slug 与该版本快照相同；核心/开场白及必要公开字段非空，公开快照字段类型及分类 UUID 结构有效。数据库不擅自补正文或分类。
- `guard_persona_publication`：公开状态或指针变化需明确的事务局部 publish/unpublish/archive 意图；非发布状态不能替换为另一组非空发布指针。下架和归档可保留最后发布指针作历史引用，公开 API 仍按 status 拒绝访问。
- 整份迁移显式 BEGIN/COMMIT。已有不一致发布快照会使迁移失败，所有新 DDL 回滚；不自动修改作者数据。修复旧数据必须由站长另行审查，不能篡改历史迁移。

### 授权与数据库可信边界

事务意图通过 `set_config(..., true)` 只在已鉴权 API 的发布事务内设置，提交/回滚后失效。它用于防止意外泛型写入，**不是管理员身份验证**。拥有数据库写凭据的主体可以自行设置该标记；DDL/所有者权限还可以改变触发器。因此不能宣称数据库独立识别站长或抵抗数据库管理员。

业务授权依赖服务端会话、owner 角色、精确 Origin、CSRF 及严格输入白名单。站点访客不能提交 SQL 或意图标记。生产部署前必须将迁移账户与应用账户分离，禁止应用拥有 DDL/禁用触发器能力，限制凭据与网络访问。本地测试账户为重放迁移而拥有隔离库权限，不等于生产最小权限已配置。

## Cookie 选择与兼容性

现有流程没有第三方 OAuth 回跳依赖 Lax，同源 Web→API rewrite 与登录后 GET session 可使用 Strict。Strict 不能替代 CSRF 和 Origin 校验。

站外顶层导航首次请求可能不携带 Strict Cookie并返回 401/跳登录；数据库会话没有因此撤销。显式站内继续或刷新可携带原 Cookie。回归以本地合成跨站页面验证真实 Chromium 行为，不连接外部攻击站点。生产自定义域名、Workers Service Binding 与实体 Safari 行为仍待迁移验证。

## 实际测试环境与结果

官方 PostgreSQL 16.16、固定镜像 digest a49f7438ba03589f9b1ca062f2da82e899b48ea1dc50d2449fa09a70be83ebca；仅新建归属标签匹配的临时测试容器、随机凭据和回环端口。每个测试套件使用随机 schema 重放迁移并清理；没有 SQLite 替代或生产连接。

| 检查                             | 结果                   |
| -------------------------------- | ---------------------- |
| 严格 TypeScript                  | 通过                   |
| 前后端生产构建                   | 通过                   |
| 冻结锁文件离线安装               | 通过；没有更改依赖版本 |
| 单元/共享契约/原 mock API        | 15 passed，3 todo      |
| 真实 PostgreSQL/认证/管理/完整性 | 37 passed，0 failed    |
| 原浏览器回归                     | 待最终记录             |
| 数据库后台/竞态/Strict 浏览器    | 待最终记录             |
| Prisma 与实际迁移结构 diff       | 无差异                 |

合计 **68 项可运行测试通过、最终失败 0、另外 3 项 todo 未计为通过**。本地 PostgreSQL 和浏览器结果不代替 Workers 或托管数据库验收。

新增数据库验证覆盖：有效新人格/版本/管理员/访客重绑定被拒绝，正常状态更新成功；异常发布字段、跨人格版本、错 slug、空指针和异常快照被拒绝；事务意图提交/回滚不泄漏；两次同时发布仅一次成功；slug 冲突回滚修订、指针及审计；空内核不自动补全；旧快照预检失败后无部分 DDL 和作者数据改动。

认证回归保留正确/错误登录、实际会话确认、刷新、退出、改密撤销、绝对/空闲过期、跨站 Origin/Fetch 元数据、CSRF 绑定、HTTPS Secure/本地 Cookie 命名空间隔离及 DB 故障。原有创建、保存、发布、下架、归档、版本恢复、并发编辑、20 轮、幂等、重试、刷新、切换、清除与移动布局测试保留。

首轮新增 Strict 浏览器测试因本地合成 HTML 未声明 UTF-8，中文链接名称解码错误而超时；已修正测试页面 charset，未放松 Cookie/401 断言，最终重跑结果以下列最终记录为准。这不是产品认证故障，也不计作通过。

三个自动化 todo 为：真实模型费用链路、生产 HTTPS/实体 Safari、备份恢复演练。Workers PoC、托管 PostgreSQL/Hyperdrive、WASM 和大陆可达性均未执行，不计入已通过测试。

## 第四阶段接入 DeepSeek 的前置条件与阻断项

当前所有聊天仍返回固定 mock，不存在外部 provider 调用路径，也没有真实费用。现有结构不能直接打开收费模型。

| 保护项          | 当前已具备                                                 | 第四阶段必须完成的验收                                                                                                                    |
| --------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 持久化请求限流  | 登录有 LoginAttempt；QuotaBucket 已建表                    | 聊天需原子时间窗/IP与匿名身份组合限流，多实例并发、重启后仍有效；创建会话的数量上限也需原子化                                             |
| 消息/会话上限   | 访客 50 会话、单会话 1000 条消息（500轮）的 mock 容量保护  | 单条输入/输出 token、上下文窗口、保留期限与存储预算；管理员不套访客次数/每日额度，但仍受资源保护                                          |
| 全局预算        | 非负 Decimal 等基础约束                                    | AI 默认关闭、预算默认 0；按币种与价格版本原子预留/结算/退款，全局日/月熔断，跨实例测试不可超支                                            |
| 访客/管理员成本 | 身份和聊天 API 隔离                                        | 访客每身份成本上限；管理员测试独立费用上限，仍受全站预算，不能用免访客额度绕过成本熔断                                                    |
| 请求与重复扣费  | 消息 ID 去重；ChatRequest/AiUsageRecord 已建表但未接入调用 | 持久请求指纹、认领/租约/fencing、pending/done/failed/unknown 状态；重复请求不重复调用或扣费，未知结果先核对而非盲重发                     |
| 使用记录关联    | requestId 与 sessionId 各有外键                            | **补充账单与请求同会话复合关联**；当前独立外键仍允许跨会话使用记录关联，收费调用前必须修复并测试                                          |
| 超时与恢复      | mock 消息事务 NOWAIT、10秒事务上限、HTTP/客户端超时        | 外部请求不占长数据库事务；持久任务超时/租约恢复、断网/进程崩溃/供应商已收费但响应丢失场景、有限重试和退避                                 |
| 聊天可用状态    | 入口检查公开发布状态；归属已锁定                           | **修复下架状态检查与消息写入分离的竞态，以及发送路径未拒绝 closed 会话的问题**；在派发边界重新原子校验，不能给已关闭/下架会话派发收费请求 |
| 密钥与出口      | 当前不需要真实 Key                                         | 仅服务端 Secret，禁止 NEXT_PUBLIC/客户端/日志/仓库；限制供应商出口、轮换与最小权限；无 Key/坏配置 fail closed                             |
| 故障审计        | 管理员变更审计不可变，错误响应有 requestId                 | 所有身份的异常安全事件、费用决策与请求生命周期需要持久审计；避免复制原文/密码/令牌；保留与删除策略、备份恢复演练                          |

请求认领、预算预留、模型派发和最终结算必须有一致的幂等边界；真实费用超过预留时不能丢弃实际账单，应记录差异并熔断。保护策略不得自动修改站长内核来缩短 token；需明确拒绝/预算管理，不隐式改写原文。

上述未实现链路是收费 AI 的上线阻断项，不因为本轮数据库/浏览器测试通过而视为完成。接入前需新增 provider mock 的计费状态机/故障注入测试，随后在明确授权预算下才可进行真实供应商验证。

## Cloudflare 结论与待验证范围

完整报告见 cloudflare-feasibility.md，含固定版本官方源码链接、依赖矩阵和费用计算。本次官方文档站部分请求 403，已改读 Cloudflare 官方 GitHub 文档源码；没有以403页面当作技术依据。

推荐保留 PostgreSQL，先在独立目录验证 OpenNext 和 Workers fetch 边界；vinext 为官方当前默认推荐但仍 beta，应单独比较。原生 Argon2 N-API、Prisma 原生引擎、常驻 Node 入口、请求作用域连接和敏感查询缓存是主要阻断项。Hyperdrive 初期禁查询缓存，避免撤销/下架读旧值。

公开成本示例为 Workers Paid $5/月起加外部 PostgreSQL；一组小型付费 PG 假设约总 $20.19/月，未含税、域名、日志、备份和 AI。免费额度不是可用性承诺，大陆访问尚未实测，不保证稳定。

本轮没有迁移到 D1、改变密码哈希算法、删除约束或上传任何服务。后续本地 Workers 验证、云资源、域名与迁移均需独立审批。本地提交后停止，等待审核，不推送。

## 文件清单

共 20 个变更路径（6 新增、14 修改），全部位于 v2/。没有删除或改写旧版根文件，依赖版本与锁文件保持不变。

```text
M  v2/README.md
M  v2/apps/api/src/auth.ts
M  v2/apps/api/src/database-app.ts
M  v2/apps/api/src/personas.ts
M  v2/apps/web/src/components/admin-workspace.tsx
M  v2/docs/api-contract.md
M  v2/docs/authentication.md
M  v2/docs/data-model.md
M  v2/docs/openapi.json
M  v2/packages/api-client/src/admin.ts
M  v2/packages/shared/src/index.ts
M  v2/scripts/generate-openapi.ts
M  v2/tests/database/system.test.ts
M  v2/tests/e2e-database/admin.spec.ts
A  v2/database/migrations/0004_immutable_chat_publication/migration.sql
A  v2/docs/cloudflare-feasibility.md
A  v2/docs/phase-3-1-status.md
A  v2/tests/database/cookie-security.test.ts
A  v2/tests/database/migration-preflight.test.ts
A  v2/tests/database/phase-3-1.test.ts
```
