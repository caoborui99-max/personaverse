# PersonaVerse 2.0 本地运行与稳定性验收

日期：2026-11-16。开发分支 `feat/v2-minimal-mobile-ui`，本轮基线 `efb138a60865aa6cea2574ff6accedce2a48bf54`。只在隔离本地环境运行，不推送、不部署、不连接生产或收费服务。

## 当前运行方式

- 前端：<http://127.0.0.1:4310/>；人格广场 `/explore`、注册 `/register`、用户 `/login`、个人中心 `/account`、历史 `/history`、收藏 `/favorites`。
- API 健康检查：<http://127.0.0.1:4311/api/v1/health>；浏览器通过前端 `/api/v1/` 同源反向代理访问。
- 管理后台：<http://127.0.0.1:4310/admin/login>，Owner与Viewer使用独立管理员认证。
- 所有地址仅为**当前工作环境的回环地址**，不是公网部署，也不能理解为其他电脑自身的 localhost。
- 以 `next build` 后的 `next start` 和编译后 Fastify API 实际运行，不是静态截图、API inject或前端假登录。
- APP*ENV=test、PV_MODE=database；隔离 PostgreSQL 16固定digest容器、随机本地端口/凭据、独立 pv_runtime*\* schema。API启动不自动迁移或创建账号；明确的 preview:prepare 命令才会迁移并初始化随机测试管理员。
- 普通邮箱密码注册/验证/登录可用，邮箱验证只通过私有本地模拟邮件，不发送真实邮件。Owner/Viewer密码由安全随机数生成并以原Argon2id策略存储，没有固定默认密码。
- **运行实例热土保持关闭**，PV_RENGINE_MOCK=0；真实模型未接入。聊天采用现有确定性mock回复并写PostgreSQL。费用执行器 fakeEnabled=false、单次预算上限0、无正预算和费用账本记录；不能将本轮聊天报告为真实DeepSeek或收费Provider测试。

`.local-preview/`是700私有目录；private-state.json、journey-private.json及日志/模拟邮件含本地测试凭据或私密测试资料，使用600权限，不公开服务、不提交Git。前者有随机Owner/Viewer账号，后者的user字段是可继续登录的普通测试用户，outsider字段是已经注销的负向测试账号，供当前环境审核时读取。测试邮箱均为test.invalid，不使用真实用户邮箱。

最终交付保留本地前端、API和隔离容器运行，便于继续浏览审核；生命周期随工作环境，不承诺跨环境或主机重启持久性。

## 真实浏览器路径

新 `tests/e2e-runtime/site.spec.ts` 使用Playwright + 系统Chromium连接已启动的网站，不用page.route伪造响应。路由守卫只允许同源流量，任何浏览器外站请求会失败并使验收失败。

| 场景                  | 实际操作及断言                                                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 Owner内容生命周期  | 后台登录并读取服务端owner角色；创建空白草稿、分类，填写明确TEST ONLY资料，保存/刷新核对原文，发布→公开200，下架→公开404，再发布供用户验证；移动截图。 |
| 02 公开入口和用户聊天 | 首页、广场搜索、详情、一键聊天入口；UI注册并从私有outbox完成邮箱验证；确认真实用户会话；20轮mock、输入框恢复、刷新后同sessionId和40条消息；收藏。     |
| 03 独立设备与退出     | 新BrowserContext独立Cookie登录同账号，从列表继续旧聊天；收藏刷新恢复；退出后服务端401，历史和收藏页面重定向登录。                                     |
| 04 Viewer权限         | UI登录确认viewer角色；创建被403拒绝并显示明确提示；编辑、发布、下架、归档均403，revision和发布指针不变；不能读取普通用户私聊。                        |
| 05 真实进程重启       | 保留浏览器Cookie，停止并重新启动本轮自建API进程；重新读取服务端会话、20轮历史和收藏，内部用户ID不变。                                                 |
| 06 删除与隔离         | 另注册验证用户B，读取/写入/删除A的会话均404；B建立自己的聊天后通过UI注销，原会话401；A仍能读原记录，通过UI删除后404；再建保留会话供审核。             |
| 07 布局与错误检查     | 在320/375/390/768/1440宽度浏览首页、广场、个人中心、收藏、历史列表/详情，无水平溢出；健康检查、热土关闭、移动与桌面截图。                             |

逐场景记录 pageerror、HTTP失败、console.error及外站请求。期望的未登录401、Viewer写入403、未发布404按具体路径和状态显式登记，原始记录仍保留；并非忽略全部错误。验收要求未捕获JS异常、非预期HTTP/控制台错误及外站请求均为零。

聊天等待实际响应、消息数量、输入框恢复及最后回复至少50%进入视口后截图，不以固定延迟掩盖滚动/加载竞争。服务启动使用有上限的健康轮询；轮询间隔不是替代业务断言的睡眠。

只有明确标记的中性测试占位资料，经测试Owner在隔离站点手动点击发布。没有初始化自动发布、没有放宽isTest发布约束、没有生成或修改任何正式人格原文。

## 发现的问题与修复

1. **运行文件与Playwright输出清理冲突。** 初版工具把状态和模拟邮箱放在test-results/；原有公开浏览器套件默认清空该目录，清除了运行凭据和截图。数据库schema及数据未被删除。已将运行状态、邮箱、日志和证据移到独立的 `.local-preview/`，新增Git/格式忽略；新套件输出移到playwright-report/runtime-\*，避免和其他套件互相清理。修复后显式初始化了另一个全新隔离schema，原schema未修改。额外执行原有公开11项测试，前后逐字比较停止状态的private-state.json，确认清理不再影响运行元数据，再恢复网站重验全部7项。
2. **验收选择器歧义。** 首次Viewer测试的getByRole('alert')同时匹配权限提示和Next路由播报器；实际服务器已经403拒绝。改为匹配精确权限提示，保留全部403及数据未变化断言，不用first()掩盖歧义。该次运行3通过、1失败、3因串行依赖未运行；最终完整重跑全部通过。
3. 新增启动工具的status对象最初有重复属性，TypeScript阻止执行；改为明确的Healthy/URL字段后通过检查，不涉及业务权限。

未发现需要修改现有认证、人格、聊天或费用业务逻辑的新运行阻断。没有删除原测试、降低安全断言、添加假登录或改写历史迁移。

## 本轮独立执行结果

| 范围                   | 通过 | 最终失败 | TODO/其他跳过 |
| ---------------------- | ---: | -------: | ------------: |
| Node单元/契约          |   42 |        0 |        3 TODO |
| 真实PostgreSQL数据库   |  122 |        0 |             0 |
| Node原有公开浏览器     |   11 |        0 |             0 |
| Node管理员浏览器       |    5 |        0 |             0 |
| Node用户浏览器         |    5 |        0 |             0 |
| 新增已运行实例完整流程 |    7 |        0 |             0 |
| Workers API具体用例    |   33 |        0 |             0 |
| Workers管理员浏览器    |    5 |        0 |             0 |
| Workers用户浏览器      |    5 |        0 |             0 |

合计 **235个具体用例通过、0最终失败、3原有TODO、无其他最终跳过**。Node192，Workers43。test:workers的Vitest显示35项：33API + 2个浏览器套件包装；展开浏览器10项后为43，不能将包装和子用例双计。重复复跑不重复累计到235。

3个原有TODO：真实AI、生产HTTPS/真实iPhone Safari、加密备份完整恢复，未计入通过。所有数据和用量均为本地测试或模拟值。

其他实际检查：离线frozen-lockfile安装、TypeScript、Workers类型、Prettier、Fastify/Next构建、OpenNext目标构建、Prisma客户端生成及Schema一致性通过。为最终Node预览在Workers构建后重新执行Node构建。

环境：Node24.22.1、pnpm11.25.0、PostgreSQL16、Chromium及本地workerd。真机Safari、长期压力和生产负载未在本轮验证。

## 数据库事后核对

`pnpm preview:verify` 只连接明确隔离的运行schema，并检查：

- 0001—0008全部成功应用、无回滚，数据库登记checksum与每个迁移文件SHA-256一致；历史迁移源码未改。
- 当前用户的保留聊天归属正确，3轮共6条消息；删除聊天有tombstone且消息为0。
- 注销账号status=deleted、所有会话撤销，其聊天有tombstone、消息为0；另一用户收藏仍为1。
- 当前验收人格的所有内核版本仍与保存的中性测试原文完全一致。
- 运行库external身份/事务均0，费用执行器关闭、单次上限0、无正预算、ledger为0。

这不代表在网页上执行了收费模型或非空费用结算；非空账本、并发预算、故障回滚及不可变关系由本轮重新执行的数据库/Workers回归覆盖。

事后检查结果在 `.local-preview/database-verification.json`，每场景浏览器诊断在 `.local-preview/diagnostics/`，14张截图在 `.local-preview/evidence/`。成功浏览器报告位于 `playwright-report/runtime-results.json`。私有状态/邮件/失败trace不能作为公开附件；交付截图仅复制已检查的明确测试界面。

## 重新启动与检查

在当前Linux工作环境，使用已有隔离容器和准备好的状态：

```sh
cd v2
pnpm preview:status
pnpm preview:verify
# 需要停止/恢复时：
pnpm preview:stop
pnpm preview:start
# 原有Cookie与数据库在API重启后继续使用：
node --import tsx scripts/local-preview.ts restart-api
PV_CHROMIUM_PATH=/usr/bin/chromium pnpm test:runtime:e2e
```

从新的空白本地环境初始化（需要Node24、pnpm、Docker及系统Chromium）：

```sh
cd v2
pnpm install --frozen-lockfile
pnpm db:test:start
pnpm db:generate
pnpm build
pnpm preview:prepare
pnpm preview:start
PV_CHROMIUM_PATH=/usr/bin/chromium pnpm test:runtime:e2e
pnpm preview:verify
```

prepare拒绝覆盖已有状态；启动拒绝占用已有端口；停止只操作记录了匹配Linux进程起始时间的自建进程，不清理其他服务。日志和凭据保持私有。此工具使用/proc进程身份检查，其他操作系统需适配，不属于网站本身的跨平台兼容性承诺。

原有固定端口的Node浏览器回归前先preview:stop，结束后再preview:start，运行schema不作为回归清理目标。其他测试继续各自创建、迁移和销毁独立schema。

本轮为了审核保持隔离容器运行。最终不再需要时，先preview:stop再pnpm db:test:stop；后者会销毁tmpfs测试数据。当前状态不是生产持久化或备份方案，环境销毁后不能保证仍可访问。

## 剩余边界

这是本地功能、隔离、重启恢复与移动视口验收，不是生产部署或长期稳定性承诺。正式邮件、HTTPS/真机Safari、托管数据库、备份与保留治理、真实外部认证和真实AI均仍需后续单独验证。

本轮不修改main/备份/旧版网站，不操作腾讯云、生产数据库、部署配置或远程资源；没有使用之前暴露的热土Token；没有调用付费服务。提交只包含v2/内的运行工具、测试配置、测试和文档，不包含凭据、数据库地址、截图或其他生成产物。

## 文件清单

共 7 个文件，全部在v2/：

- `v2/.gitignore`
- `v2/.prettierignore`
- `v2/docs/local-runtime-validation.md`
- `v2/package.json`
- `v2/playwright.runtime.config.ts`
- `v2/scripts/local-preview.ts`
- `v2/tests/e2e-runtime/site.spec.ts`
