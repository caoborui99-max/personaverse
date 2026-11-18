# A.1：授权与模拟发送之间的竞态复核

本文件描述已实现、已在隔离 PostgreSQL 验证的 **Fake-only** 补丁，以及真实 Provider 仍需满足的边界。没有真实供应商、API Key 或收费请求。

## 原窗口

A 阶段 `dispatch()` 把请求从 reserved 改为 running 并提交，随后 `runFake()` 才调用 Provider。两者之间若会话关闭、人格下架或开关关闭，原逻辑仍会开始模拟执行。不能把“数据库授权已提交”说成“供应商已接收”，也不能用此说法掩盖尚未开始的可取消请求。

## 当前实现

1. 原子预留事务先持久化 hold、请求、费用版本与预算；授权事务持久化 running、租约和 fencing token。
2. 新增 `beginFake()`。重新锁全局控制行、会话行、人格共享锁及相关预算，复核所有者、状态、开关、租约、价格、token/金额限额、预算削减与全局并发。状态不满足时同事务释放预留、写 failed 与 `CANCELLED_BEFORE_FAKE_SEND`；Provider 调用数为零。
3. 检查通过后，在这些状态锁仍有效期间记录 `FAKE_SEND_STARTED` 并同步调用固定 Fake Provider 的入口。它在第一个 await 前计入执行次数，作为本模拟器的 admission 点。**事务不等待完成 Promise**；只把它带回事务外等结果，保留超时、unknown 与幂等结算逻辑。
4. 会话关闭与人格下架使用同一数据库行的排他写锁，因此已完成的关闭/下架先发生则取消；Fake admission 先发生则其后关闭不能抹去已开始请求的会计责任。
5. 预留与 running 在 admission 事务之前已经独立提交。即便 admission 后 COMMIT 断连，不能假定未执行：failure/recovery 转 unknown，预留保持，不重试、不重复结算。`FAKE_SEND_STARTED` 事件本身可能回滚，事件不存在也不证明未发送。

原 `checkDispatch()` 被提取为授权与 admission 共用检查；原费用限制、不可变账本、复合外键、恢复 token、全局熔断保留。没有改写 0001—0006。

## 新增真实 PostgreSQL 测试（5 项）

`tests/database/budget.test.ts`：

- 在重载 dispatch 的可控间隙分别关闭会话、下架人格、关闭开关：三例均未调用 Fake，预留释放。
- Fake 同步 admission 后暂停响应，关闭会话仍能完成，随后恢复响应并结算：证明没有在事务中等待 Provider 响应，关闭不能取消已开始的会计责任。
- 用 DEFERRABLE 约束触发器在 admission 后 COMMIT 时 `pg_terminate_backend`：已执行一次，结果 unknown，hold 不释放。

原有跨实例预算竞争、并发重复键、租约过期、stale fencing、断连回滚和不确定结果测试仍保留并通过。本轮数据库套件共 76 项。

## 不承诺外部 exactly-once

Fake admission 是同步的、本进程可观测边界。它不是供应商网络接收凭证。未来真实 `fetch()` 可能排队、DNS/TLS 失败、部分写入、供应商接收但客户端超时；不能把本模拟器同步入口直接当作真实网络发送/接收保证。

真实 Provider 接入前必须单独审核：

- 在预算已经提交的前提下定义发送尝试、供应商接收、结果未知、完成各阶段与证据。关闭之后不能发起新的发送尝试；先前已开始的尝试仍可能稍后被供应商接收并计费。
- 若沿用有锁 admission，只允许同步开始传输，不在数据库事务中等待供应商响应或任何长网络准备；必须验证实际实现、锁持有时间、连接占用、故障和取消行为。不能直接把当前 Fake-only 方法替换为任意异步 SDK。
- 数据库提交和外部 HTTP 无分布式原子提交。调用后提交失败也必须保留可能收费敞口；取消/断网不代表供应商没收费。
- 有供应商幂等键时仍需核实其作用域、时效、重试语义与账单证据；不支持幂等或逐请求对账时无法保证严格外部 exactly-once。
- unknown 禁止盲目重发或自动免费释放，只能凭受控证据追加对账。恢复任务与管理员权限、审计及熔断不得绕过。

本轮验证只覆盖 Node + 真 PostgreSQL 的 Fake 竞态。Workers 已验证费用 API 默认关闭；未开启 Workers 收费路径，未模拟为真实 DeepSeek 验收。
