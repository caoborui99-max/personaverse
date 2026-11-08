# --check 隐式写入修复审查

基线：PR #2，`review/staging-deploy-script`，`9a78fc74b090013001260bf00b65f9f326e8a0c0`。
固定部署目标仍为 `8d37d06065d6e0c8b05c2ee7bf7eec4fc7ce0844`。
本修复不更新PR #2、不合并main，不执行服务器、准备或部署动作。

## 原调用链及处理

| 原 --check 路径 | 隐式写入/其他影响 | 修复 |
|---|---|---|
| `main → preflight → git status` | 索引刷新、fsmonitor/过滤器、trace、对象按需下载 | 独立offline_check；禁用可选锁/辅助程序/协议/trace环境；只读内核挂载兜底；不确定配置停止 |
| `schema_check → sqlite3.connect(mode=ro)` | WAL/SHM或临时文件仍可能写 | --check不调用该函数；独立快照只读取字节，内存deserialize；拒绝WAL/SHM/journal/过大/损坏/不匹配快照 |
| `proxy_check → nginx -T` | 配置引用日志可能打开/创建 | 从纯检查移除，仅在显式可能写入的prepare/apply中保留 |
| `health → curl GET /api/session` | 本机/远端应用访问日志、未知旧版本请求副作用 | 从纯检查移除；只读模式网络命名空间隔离，成功不宣称在线检查通过 |
| `system/process/environment_files` | 读取真实进程环境和密钥文件，systemctl/DBus交互 | 从纯检查移除；本轮也未调用真实路径 |
| `--check --fetch` | Git对象、FETCH_HEAD、网络及潜在维护 | parser拒绝；只允许 `--prepare --fetch`，清楚标识有写入 |
| `main → 部署锁` | 锁文件创建、flock | --check提前返回/停止，不进入os.open锁路径；保留apply原锁 |
| Python启动、普通读取与目录遍历 | pycache、site自定义初始化、atime | 启动器-I/-B/-S，全部挂载ro；边界验证失败即STOP。启动器必须位于检查目标之外 |
| 快照一致性 | ro绑定不能阻止其他进程修改底层文件 | 只接受独立已批准准备的离线快照，检查读取前后元数据；不冒充在线库检查 |

## 模式与范围变化

纯 `--check` 不再复用在线 preflight，不扫描在线服务、不调用外部HTTP，也不读取真实凭据。
它核验显式提供的仓库和独立快照；不会自动下载目标、复制/修改数据库、创建mountpoint目录、安装依赖、改权限或生成临时文件。
启动器只在子命名空间建立只读绑定和隔离网络，工作进程验证内核真实状态，没有 `--unsafe` 或以环境变量跳过保护的入口。

原8000/9000路径、用户、监听隔离、管理员配置验证、AI关闭、来源/代理检查、精确SHA/补丁范围、迁移一致性、备份和代码回滚约束保留在在线prepare/apply。离线校验不会授予部署权限。

## 证据与测试

测试用真实临时Git仓库及SQLite快照，而不是逐行镜像实现。对比路径清单、文件SHA256、权限/所有者、大小、inode/device、nlink、atime/mtime/ctime，包括目录。对比器使用O_NOATIME，测试前故意将atime设旧，不在事后恢复元数据。

正常/失败场景在真实只读绑定和隔离网络中调用main的 `--check` 分支。唯一fixture替换为允许的CURRENT基线提交，固定部署SHA常量不变。覆盖正常、脏工作区、校验和不匹配、WAL/SHM、WAL格式头、损坏SQLite、危险Git配置。隔离不可用则明确停止；CI以PV_REQUIRE_READONLY_SANDBOX=1强制运行，不能skip。

本地云端嵌套命名空间被平台拒绝，已验证停止路径和普通回归；完整隔离场景以新分支GitHub Actions结果为准。详见 `test-results.txt` 和PR中的CI链接，不把本地跳过报告成通过。

## 剩余边界

- Python3.11+及bubblewrap/内核命名空间必须已经具备。Ubuntu22.04默认Python3.10不满足时停止，不自动安装。
- 工具启动前的解释器/脚本读取、宿主审计/终端日志及调用者输出重定向不能承诺全宿主零副作用；工具需位于被检目录外。内核边界建立失败时不读取检查目标、不宣称只读成功。
- 只读视图不冻结其他进程；快照准备及一致性必须另行批准，不能传在线数据库。
- 离线PASS不是在线部署可行性证明。真实systemd、环境、代理、服务和管理员登录需要之后单独批准检查。
- 原部署的断电/SIGKILL/磁盘故障恢复风险没有消失。本轮无服务器、迁移、重启、真实凭据或模型访问。
