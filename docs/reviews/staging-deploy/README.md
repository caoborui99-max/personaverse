# PersonaVerse 9000：只读检查修复审查包

固定部署目标：`8d37d06065d6e0c8b05c2ee7bf7eec4fc7ce0844`。
原 PR #2 / `review/staging-deploy-script` 保持不变；本修复在独立分支提交。
本次没有服务器操作、真实凭据读取、迁移、重启或模型调用。

## 纠正之前的只读描述

原 `--check` 共用了在线 preflight：`git status` 可能刷新索引；SQLite `mode=ro` 仍可能创建/更新WAL/SHM；`nginx -T`可能打开日志；HTTP请求可能触发访问日志。仅禁止显式DML、关闭Git可选锁或设文件权限不足以保证无写入。

新模式明确分开：

| 模式 | 作用 | 写入属性 |
|---|---|---|
| 默认 / `--check` | 隔离校验已审核仓库及显式提供的独立一致性数据库快照 | 必须先验证所有挂载只读、网络命名空间隔离；否则停止 |
| `--prepare` | 原有在线预检：进程、systemd、环境、数据库、Nginx和HTTP | **可能写入**Git索引/SQLite旁路文件/服务日志，需要另外授权 |
| `--prepare --fetch` | 在线预检并拉取固定分支的对象 | **会写入**Git对象和FETCH_HEAD，需要另外授权 |
| `--apply` | 原有完整部署前置检查、备份、固定SHA检出、9000启停及回滚 | **会写入并操作服务**，必须另行批准；本轮禁止执行 |

`--check --fetch`、`--check --prepare`、`--check --apply`、单独 `--fetch` 均拒绝。离线路径参数不能用于修改prepare/apply的固定目录。

**通过离线检查不代表9000已完成在线部署预检。** 成功输出明确含 `LIVE_DEPLOYMENT_READINESS=UNVERIFIED`。不会以离线结果替代对真实代理、监听进程、配置和数据库隔离的确认。

## 只读边界与前置条件

1. 通过 `check-readonly.sh` 启动 `/usr/bin/bwrap`。只在子命名空间将 `/` 及其子挂载绑定为只读，隔离网络，不改宿主挂载/权限，不创建磁盘临时文件；不安装依赖。缺bubblewrap或内核不允许命名空间即停止。
2. Python以 `-I -B -S` 启动，禁用用户路径、环境注入、site初始化和字节码缓存。工作进程验证内核mountinfo每个挂载为ro，且网络命名空间不同于宿主PID1；没有跳过边界检查的参数或环境变量。
3. Git同时使用 `GIT_OPTIONAL_LOCKS=0`、`--no-optional-locks`，禁用fsmonitor/untracked cache/split index、钩子、全局/系统配置、协议和lazy fetch。遇到本地filter/include/扩展配置、子模块、属性文件等不确定情况停止。不会调用凭据助手或读取SSH/环境文件。
4. SQLite必须是**已经独立批准准备的完整快照**，路径明确提供，位于仓库及8000/9000目录以外，没有硬链接/符号链接或 `-wal/-shm/-journal`。只接受数据库头为rollback-journal格式的完整快照，不能传正在使用的服务库；脚本不备份、不checkpoint、不改journal_mode、不补齐文件。
5. 从只读文件读取字节后，仅用 `sqlite3.connect(':memory:')` + `deserialize` 校验；固定查询、temp_store=MEMORY、query_only=ON、trusted_schema=OFF。没有磁盘SQLite连接或immutable打开在线WAL的回退。
6. 内存校验要求Python 3.11+，最大256MiB；Ubuntu22.04默认Python3.10通常不满足，直接停止，不自动安装或退化成磁盘读取。
7. 仓库只接受原审核基线 `0018aceea9c39df71e8e4a4a100478d2a95379f6` 或固定目标SHA。快照schema校验和必须匹配该已知提交；不迁移、不修复、不初始化。

保证范围：校验工作进程对其挂载视图内的文件数据、清单及元数据不写入；不会发HTTP请求、操作服务或在线数据库。启动器/解释器本身在边界建立前需要被读取，必须从独立于被检仓库/数据库的已审核工具位置运行；不能声称裸 `python script --check` 的启动过程对整个宿主完全无副作用。宿主审计/终端日志、调用者主动重定向stdout及其他进程的并发写入不受该子进程控制。无法确认边界时只输出STOP，不输出PASS。

只读绑定不冻结其他进程；操作者必须提供已经离线、一致且不再被写入的快照。数据库读取前后检查inode/大小/mtime/ctime，完整性和迁移检查只证明读到的快照，不证明在线库当前状态。

## 后续获批后的检查入口（本轮不执行）

工具及快照必须通过**已经批准的准备动作**放置好。本脚本不下载、不复制、不改权限、不生成快照，也不会猜测已上传位置。

参数形式如下，`<...>` 是需要操作者确认的实际绝对路径，不是可直接执行的命令：

```text
sh <独立工具目录>/check-readonly.sh \
  --repository <已审核仓库绝对路径> \
  --database-snapshot <独立完整数据库快照绝对路径>
```

运行前核对SHA256SUMS及ZIP校验和。只分享脱敏PASS/STOP、固定提交和错误类别，不分享环境文件、快照、备份或凭据。

在线 `--prepare` 和部署 `--apply` 的命令不作为本次只读流程的一部分提供。不要为了让检查通过而安装依赖、放宽权限、禁用安全保护、修改代理、迁移数据库或重启服务。

## 原部署限制完整保留

`ROOT=/opt/personaverse-test-staging`、`OLD_ROOT=/opt/personaverse-test`、预发布用户pvstaging、127.0.0.1:9000/8000隔离不变。prepare/apply仍要求独立SQLite、数据库实际inode匹配、AI_ENABLED=false、既有管理员配置、HTTPS APP_ORIGIN/TRUST_PROXY=loopback、严格Nginx来源校验、固定提交/8文件补丁范围、schema一致、完整备份及代码回滚。失败仍不覆盖数据库、不重置账号、不修改密钥、不影响8000。只读检查没有放宽这些部署门槛。

原部署的SIGKILL/断电/磁盘损坏风险不因本修复消失；不宣称进程内回滚覆盖这些情况。本次没有运行任何真实部署或prepare。

## 自动化测试和复核

```sh
python3 -B -m unittest -v test_release.py test_readonly.py
```

- 原12项回归保留。
- 新增模式互斥、边界失败、固定SHA、禁止凭据/在线/锁路径、Git无锁环境测试。
- 新增真实临时Git仓库及SQLite快照的清单对比：路径、SHA256、mode、uid/gid、inode/device、nlink、size、atime/mtime/ctime纳秒值，包括目录。对比器使用O_NOATIME，不通过事后恢复时间戳伪造无写入。
- 隔离中运行真实 `--check`，覆盖正常通过，以及dirty、迁移不匹配、WAL/SHM、WAL头、损坏SQLite、危险Git配置等失败退出。测试仅将允许的CURRENT基线替换为合成fixture提交，固定部署目标SHA不改；Git、快照读取和CLI路径均真实执行。
- CI设置 `PV_REQUIRE_READONLY_SANDBOX=1`，隔离环境不可用即失败；不能靠skip通过。云端本地若不允许嵌套命名空间，会明确报告该组跳过，与真正通过区分。
- 所有测试使用临时合成数据，不访问服务器、真实凭据或DeepSeek。原部署回滚测试调用的是mock，不会运行实际服务命令。

材料：脚本、只读启动器、两组测试、审查报告、测试记录、SHA256SUMS及更新ZIP。ZIP只含审核材料，另附ZIP SHA256，不含数据库/凭据/环境文件/pycache。
