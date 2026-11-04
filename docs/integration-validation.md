# 第一阶段工程整合验收

## 基线与边界

独立分支 `integration/engineering-baseline-v01`，基于 `preview/static-mobile-v01` 的 `1297c8889c0988303c89d917c70ffb5e92f7da02`。开始时工作区干净。

GitHub 只读复核：main=8bd91fc、upgrade/mobile-admin-chat=13e07ba、phase2/ai-provider-minimum=e2a1dce、deploy/cn-single-server=558879b、preview/static-mobile-v01=1297c88。前三阶段是继承关系。大陆远程558879b与预览前置本地cba51b3文件树同为67dfe4887eda352cb392e01697c9e622ec39730b，无需重复cherry-pick。本轮没有合并或重放这些提交。

不修改main、预览发布分支、静态产物、部署配置及生产数据；不运行真实AI。现有部署配置仅检查，不执行部署。所有SQLite验证使用临时测试数据库，代理测试本次未能启动。

## 实际修改

- scripts/build.js：移除数据库连接、迁移和种子初始化；保留配置检查及JS语法检查。语法检查用异步子进程继承输出，启动错误/退出失败明确拒绝构建。
- scripts/migrate.js：生产标记下显式迁移要求 `--confirm-production`，仅是防误执行措施，不替代备份与目标核对。
- server/handler.js：公开人格使用字段白名单，隐藏内部背景、创建者、审核及未知字段。只有copyEnabled严格等于true时返回可复制prompt，管理员完整资料不受影响。原认证和同源策略保留。
- scripts/check-preview.mjs：语法检查改为异步继承输出，保留所有静态白名单、资源/网络检查及镜像一致性断言。
- tests/integration.test.js：新增公开列表/详情字段隔离及管理员四种方法拒绝、显式复制、构建无数据库副作用、生产CLI拒绝回归测试。
- README.md、docs/vercel-test.md：纠正构建会迁移数据库的旧说明。后者保留为旧平台参考，不表示当前建议部署Vercel。
- 本报告：记录本轮结果及限制。

## 实际结果

| 命令 | 结果 |
|---|---|
| node tests/mvp.test.js | 5组通过，0失败；含旧数据/重复迁移、权限与持久化 |
| node tests/ai.test.js | 5组通过，0失败；全部Mock |
| node tests/china.test.js | 4组通过，0失败；含持久路径、备份和不覆盖恢复 |
| node tests/integration.test.js | 最终3组通过，0失败 |
| npm test | 最终4个测试文件通过，0失败；上述文件内共17组 |
| env -u DATABASE_URL -u VERCEL AI_ENABLED=false node scripts/build.js | 通过；未配置真实数据库连接 |
| node scripts/check-preview.mjs --mirror | 最终通过；12人格、白名单/相对资源/语法、两个静态副本一致 |
| git diff --check | 通过 |

构建回归在只传入非真实数据库地址的隔离子进程中执行成功；没有继承真实数据库或AI密钥。生产CLI测试不带确认参数，连接数据库之前拒绝。

首次新增测试曾出现1组失败：沙箱对管道捕获的子进程输出返回空值，不能据退出码假定子程序成功。最终改为临时文件捕获日志并保留退出码与输出断言，无额外权限、无跳过断言，3组复验通过。早先额外权限请求未完成，本轮没有依靠该权限运行测试。

三项尝试启动但被环境阻塞（不是功能验收通过）：

- python3 tests/preview_browser.py
- python3 tests/browser_smoke.py
- python3 tests/proxy_smoke.py

均在socket创建阶段报PermissionError errno 1，未进入浏览器或代理检查；没有申请额外网络权限，不能将其写成通过。测试源码保留。需要以后在允许loopback socket的环境重跑。历史浏览器通过记录不能替代本轮复验。

未运行：真实iPhone Safari、实际Nginx TLS/systemd运行、远端Neon、生产迁移/部署、真实AI和收费调用。未安装或测试付费服务。

## 遗留风险

1. 本轮不改数据库结构；现有Node启动入口仍会执行幂等迁移/初始化，生产CLI确认参数不约束启动入口。构建已隔离，但启动生命周期与正式迁移台账还需下一轮治理；不要误认为任何启动都不会写库。
2. 现有迁移缺少完整编号执行台账和校验和，SQL/运行时结构有重复定义；本轮保留已有兼容路径，避免突然替换迁移机制。
3. 本轮没有操作生产数据或验证真实生产备份；现有同盘未加密备份不能代替异机灾备。
4. 公开字段改为白名单已覆盖回归；copyEnabled=true和静态原创提示词仍按原产品意图公开，不构成保密承诺。未来Soul Core必须仅存服务端。
5. 不增加CORS放行，不开放普通用户真实AI。Soul Core等新架构尚未实现。
6. 已移除构建迁移的平台必须安排显式独立迁移；新数据库仅构建成功并不意味着API可用。

## 回滚

当前未部署，运行中的网站及数据库无需回滚。审核不通过时保留整合分支，切回原preview分支即可，勿reset/clean或删除工作数据。代码基线为1297c8889c0988303c89d917c70ffb5e92f7da02；以后若需要撤销已共享提交，使用新增revert提交并先核对工作区，不重写远程历史。

本轮无schema变化，不需要数据降级。未来如已有新写入，不允许直接覆盖旧备份来回滚。恢复旧代码后也不要盲目执行旧构建（旧构建可能自动迁移数据库）。
