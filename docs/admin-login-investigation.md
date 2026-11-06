# 管理员登录故障：代码复现、最小修复与生产核验

## 范围与结论边界

仓库 `caoborui99-max/personaverse`。检查时默认 `main=8bd91fc` 仅有静态页面，没有 `admin.html`、Node后端或管理员API。完整后端最新准备分支是 `prepare/dev-admin-quota-phase1=0018aceea9c39df71e8e4a4a100478d2a95379f6`，本补丁以它为基线，放在独立 `prepare/fix-admin-login`。

没有生产SSH/终端或生产配置、日志、数据库样本，本轮没有连接/修改Ubuntu服务。此前用户报告过403 ORIGIN_REJECTED；下面记录仓库中能产生同样错误的确定复现，**不能据此宣称生产进程已经核实或修好**。旧8000/9000服务、监听地址、端口、旧Sites和生产数据均未改动，未调用模型。

## 按严重程度排序

| 严重度 | 问题及证据 | 状态 |
|---|---|---|
| P1，条件已复现 | HTTPS反向代理外部Origin为HTTPS，但APP_ORIGIN未设、非Vercel时 `requestOrigin()` 构造HTTP地址；`requireSameOrigin()` 在密码验证之前返回403 ORIGIN_REJECTED。测试确认登录尝试及会话表均未插入记录。 | 需要按实际站点修正服务端来源/可信代理配置；本补丁保留校验，改为明确提示配置方向。生产是否命中待核对。 |
| P1，代码已证实 | `session()` 吞掉会话/后台列表异常，登录处理继续覆盖为“登录成功”。Cookie未建立时也一样；可出现登录表单仍可见但提示成功，或空后台面板。 | 修复：登录响应、Cookie会话和后台列表全部验证通过后才显示成功；失败隐藏并清空受保护面板，保留实际错误。 |
| P2，代码已证实 | 提交事件的submitter为null时，在try之外执行 `b.disabled=true`，抛TypeError，登录请求不会发出。 | 为登录及编辑表单增加按钮回退。此条件可复现，不代表已证实Safari特有故障。 |
| P2，代码已证实 | 非预期后端异常只记录Error名称，缺少数据库错误类别；适配器隐藏已知代理配置错误的说明。 | 仅记录固定白名单错误码、粗粒度操作及无权限意义的请求ID；已知ApiError保留安全说明。 |
| P1，部署待证 | 若实际部署的是默认main，其本身没有管理员服务；若是未知旧分支，也可能缺少后端或迁移。 | 不假定服务器用了main；必须核对实际cwd/commit。不能直接覆盖旧服务。 |

## 入口、API与认证检查

- `package.json` 的start/dev经 `scripts/dev-server.js` 启动；单机systemd模板经 `scripts/start-single-server.js` 启动。启动先验证环境和数据库就绪，Node要求24，不自动迁移。监听配置未修改。
- Node静态页面白名单提供 `/admin.html`；该页面加载 `js/http.js`、`js/admin.js` 和 `js/soul-admin.js`。管理员API经 `api/index.js` 转换为Web Request，进入 `server/handler.js`。
- `/api/auth/login`：POST、同源JSON `{email,password}`；成功200及HttpOnly Cookie，失败为结构化 `{error:{code,message}}`。前端方法、字段和返回格式一致。
- `/api/session`：GET，验证Cookie后返回user角色或null；`/api/admin/personas` 等接口只向已认证admin开放。静态admin.html本身展示登录表单，未登录管理API返回401。
- 成功后的设计是留在admin.html显示后台面板，并无跳转到另一URL。本补丁不新增自动重定向或认证重试。退出为POST `/api/auth/logout`，删除会话记录并清Cookie，前端再验证已变为未登录状态。
- 管理员来自服务端 `ADMIN_EMAIL`、`ADMIN_PASSWORD`，不是SQLite的admins/users记录；邮箱统一trim和小写，密码按原字符串验证且至少12字符。没有默认密码或自动创建数据库管理员账号。密码比较使用固定长度摘要比较；数据库不存管理员明文密码。
- Cookie为随机256位不透明令牌，数据库只存令牌摘要、管理员邮箱、凭据指纹和有效期。未使用JWT。修改管理员凭据或会话过期会使旧Cookie无效，这是现有安全设计，未放宽。

## 数据库和环境检查

认证依赖 `sessions`、`login_attempts` 及现有迁移台账，业务另依赖personas等表。启动和请求使用mustExist及迁移校验，缺失应报告MIGRATION_REQUIRED/MIGRATION_MISMATCH，而不是删除数据库或重新种子初始化。

本地默认SQLite路径相对进程cwd，systemd生产配置要求绝对持久化路径；配置示例位置不等于生产实际位置。需要核对服务User、WorkingDirectory、EnvironmentFile、实际SQLite路径、文件及父目录权限。以root读写成功不能证明systemd的专用用户能写。错误密码401、管理员未配置503、数据库未就绪503、限流429与来源403应分开判断。

本补丁**不新增或修改任何SQL迁移**，不改密码验证、Cookie安全属性、历史归属或人格数据。基线已有0005费用迁移；若旧服务部署提交更早，不能为了登录补丁直接升级整条分支或顺手迁移生产库。应先确认实际版本，再移植补丁并运行对应版本测试。

若另外决定升级数据库：先核对目标、做一致性SQLite备份并验证恢复到新文件，保留在线原库与WAL；列明待执行迁移后再单独批准。不要直接复制正在写入的主库、删除.local、覆盖原库或篡改旧迁移校验和。

## HTTPS代理的安全修正方向

对由本机受信代理终止HTTPS的部署，应在**实际对应服务的受保护环境文件**中确认：

```text
APP_ORIGIN=https://实际当前使用的站点域名
TRUST_PROXY=loopback
```

APP_ORIGIN不含/index.html、路径、查询参数或凭据，必须与浏览器当前来源一致。代理应传递匹配的Host并覆盖X-Forwarded-Proto=https；应用仍验证代理连接来自loopback。动态隧道域名改变后要核对来源与Cookie域，不能假定旧域名配置继续适用。

不要从客户端Origin直接推导可信站点，不要无条件信任X-Forwarded-Host/X-Forwarded-Proto，不要关闭CSRF或改成宽泛CORS，也不要把VERCEL=1当作单机HTTPS修复。配置重载/重启属于部署动作，本轮未执行；应只针对已确认的测试服务，不能影响8000旧服务。

Nginx模板的HTTP→HTTPS跳转只有在隧道/代理目标匹配时才合理；未知实际配置时不能认定它造成了循环。应用代码未发现Cloudflare Access Cookie改写或自动跳登录循环。本轮未更改SameSite=Strict，也没有证据将问题归因Safari。

## Ubuntu先执行的只读检查

先用以下命令确认当前进程，进程号不能沿用旧截图：

```sh
ss -ltnp '( sport = :8000 or sport = :9000 )'
```

随后对**实际选中的PID**检查 `/proc/PID/cwd` 和 `/proc/PID/exe`，在该cwd核对 `git rev-parse HEAD`。若由systemd管理，仅查询对应单元的ActiveState、User、WorkingDirectory、EnvironmentFiles及FragmentPath等元数据。不要打印整个Environment、`.env`、环境文件、进程命令行或Cookie值。

在不暴露值的前提下确认：管理员变量存在且密码长度合格、APP_ORIGIN是否合法且协议为HTTPS、TRUST_PROXY是否loopback、SQLite路径/权限/迁移是否与该代码版本匹配。需要数据库表结构时只读查询元数据与聚合数，不输出sessions记录、令牌摘要或人物私有提示词。

若仍失败，记录一次请求的状态码和错误code，以及服务器脱敏日志中的requestId/code即可；不要提交密码、Authorization、Cookie、Token、数据库连接串或Key。当前没有足够证据给出可安全执行的特定服务重启命令。

## 实际测试记录

修改前新增回归：8项中5通过、3失败。精确失败为“实际提示登录成功但会话未建立”、会话/列表错误被成功提示覆盖、以及null submitter的TypeError。HTTPS代理配置缺失的403也已在真实Node适配器函数中复现，未使用实际网络端口。

修改后新增登录回归11项通过：正确/错误密码、未登录管理API、Cookie会话确认、退出撤销、凭据变更/过期、缺配置/缺数据库、同源与可信代理拒绝、已知配置错误说明、数据库错误脱敏日志及前端失败/成功路径。全套回归与浏览器CI结果以本次交付的运行记录为准。

测试使用临时SQLite、随机合成密码，预加载断网保护；未使用生产密码、Key或数据库。浏览器脚本增加错误密码、requestSubmit提交、成功后URL不变及后台面板可用检查，并保留刷新、编辑、上下架、退出回归。实体iPhone、真实Cloudflare和实际生产配置尚未验收。

本地执行全套11个测试文件、构建及冻结静态预览检查均通过。直接运行浏览器脚本时，云端沙箱在创建loopback socket前返回PermissionError，未运行到浏览器断言；该限制不代表网站测试失败，浏览器验证交由独立分支现有GitHub Actions完成，结果在交付报告中单列。
