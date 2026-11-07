# PersonaVerse 管理员登录修复：9000 预发布脚本审查包

**尚未连接或执行任何服务器命令。本包只在当前工作区生成并做了断网测试。**

目标固定为 `caoborui99-max/personaverse` 的 `prepare/fix-admin-login`，完整提交：
`8d37d06065d6e0c8b05c2ee7bf7eec4fc7ce0844`。

## 文件

- `pv-staging-release.py`：Python 3.10+ 单文件脚本，Ubuntu 22.04 自带 Python 满足要求。
- `test_release.py`：离线自动化测试；所有 systemctl/curl/端口/回滚命令均模拟，不接触服务器。
- `test-results.txt`：本次离线测试结果。
- `SHA256SUMS`：脚本和测试文件的校验和，传输后可核对。

脚本不需安装 Python 库。需要服务器已有 `git`、`runuser`、`ss`、`systemctl`、GNU `tar`、`curl`、`nginx` 和 Node.js 24；缺失会停止，**不会自动 apt/npm 安装**。

## 明确支持的部署结构

1. 9000 唯一监听地址为 `127.0.0.1:9000`，主进程用户 `pvstaging`，实际工作目录 `/opt/personaverse-test-staging`，是普通 Git 仓库，目录不是符号链接或 Git worktree。
2. 8000 为独立的 `127.0.0.1:8000` 进程，实际工作目录 `/opt/personaverse-test`，不属于9000服务控制组。
3. 9000由 systemd 直接以 `node scripts/dev-server.js` 或 `node scripts/start-single-server.js` 启动；也允许 `/usr/bin/env node`。不支持 npm/PM2/docker 包装、额外启动参数、启动/停止钩子或可能影响其他服务的依赖动作。
4. 配置来自可确认的 systemd `Environment` 和至少一个必需的 `EnvironmentFile`。仅解析单行字面量 `KEY=value`，允许引号，不执行 shell。不支持反斜线/续行/specifier。配置值只在内存比较，输出仅包含变量名。
5. `PORT=9000`、`AI_ENABLED=false`、已有合格管理员变量、明确绝对 `SQLITE_PATH`、HTTPS `APP_ORIGIN`、`TRUST_PROXY=loopback` 均已存在。**缺少时停止，不补写或覆盖。**
6. 两个服务均为可确认的 SQLite，环境推导路径必须和两个进程实际打开的数据库 inode 一致；9000数据库不能与8000共享路径/inode，也不能被第三方进程打开。9000数据库属于pvstaging，权限0600，父目录可写。PostgreSQL或无法确认的数据源停止。
7. 当前提交必须是已审核直接父提交 `0018aceea9c39df71e8e4a4a100478d2a95379f6`，或已是目标提交。若是536b434等更早版本、不同分支的其他提交或有未提交/未跟踪改动，停止。**不能把包含新增迁移的整条准备分支当作登录补丁升级。**
8. 数据库必须已经具备目标版本的全部迁移及一致校验和。脚本不迁移、不种子初始化、不重建库、不重置账号。
9. `nginx.service` 使用标准 `/usr/sbin/nginx` 主进程；磁盘配置不晚于主进程启动，能保守证明已加载配置；仅支持唯一明确域名、443 TLS、单个 `location /` 直转 `127.0.0.1:9000`，显式传递 `Host $host` 和 `X-Forwarded-Proto $scheme`。配置含其他API location、include/认证/重写/复杂指令、代理配置符号链接等会停止。
10. HTTPS健康请求必须可在服务器直接验证证书并返回本站JSON，不接受重定向，不绕过Cloudflare Access，不使用 `-k`。**动态 trycloudflare 隧道、Cloudflare Access拦截、非Nginx代理不在自动部署支持范围，不能凭域名猜测9000映射。**

这些条件故意严格。脚本停止是阻塞报告，不表示应该修改代理、放宽权限、重启Nginx或迁移数据库；先审查实际配置，再制定适配方案。本轮没有这些操作授权。

## 手机终端步骤：先只预检

先审查 `pv-staging-release.py` 全文。通过你已有的安全文件传输方式将它放到服务器 `/tmp/pv-staging-release.py`，核对附件 `SHA256SUMS` 中脚本校验和。没有提供可在服务器直接wget的公开地址，不应使用猜测的下载链接。

```sh
sha256sum /tmp/pv-staging-release.py
```

核对一致后，将脚本安装到root专用位置：

```sh
sudo install -o root -g root -m 0700 /tmp/pv-staging-release.py /root/pv-staging-release.py
```

先运行默认只读预检：

```sh
sudo python3 /root/pv-staging-release.py --check
```

`--check` 不fetch、不checkout、不重启、不备份、不修改配置或业务数据；会读取元数据、只读查询SQLite并发送不写业务数据的站内健康请求。日志中不输出密钥/密码/Cookie/Token。

如果唯一阻塞是本地缺少目标Git对象，可在审查后允许一次准备性fetch：

```sh
sudo python3 /root/pv-staging-release.py --fetch --check
```

`--fetch` **会写入9000仓库的Git对象及FETCH_HEAD**，但不会改变工作区、分支或服务；只拉取指定分支，并要求远端头仍是固定目标SHA。不是完全只读。Git代理/网络失败立即停止，不调整代理、不循环重试。其他预检阻塞时不要为了继续而执行fetch、stash、reset或迁移。

请先审查预检输出，仅分享其中脱敏的 `STOP` 原因和元数据；不分享环境文件、数据库、备份或完整journal。

## 预检通过且批准后才执行部署

下面命令是后续部署入口，**当前不应直接执行**。使用独立的临时systemd任务，避免手机断线中断部署；它不替换现有网站服务配置。

```sh
sudo systemd-run --unit=pvstaging-admin-fix-job --collect --property=Type=oneshot --property=TimeoutStartSec=30min --property=TimeoutStopSec=10min --property=KillMode=mixed /usr/bin/python3 /root/pv-staging-release.py --apply
```

查看脚本自己的脱敏日志：

```sh
sudo journalctl -u pvstaging-admin-fix-job --no-pager -n 60
```

成功标识为 `SUCCESS: 9000 pinned to ...`。如果预检时已是目标提交，脚本不重复部署/重启。应用日志不由脚本转发，避免意外输出旧日志中的秘密。

## 部署与回滚顺序

1. 重新执行全部预检；在临时目录导出固定提交，用临时SQLite、无秘密环境及断网保护运行全部Node测试。失败不停止现有服务。
2. 重新确认代码、环境/单元/Nginx文件摘要、8000进程及Nginx进程未变化；检查备份空间。
3. 创建root专用0700备份目录，保存环境/单元/代理配置副本。停止且仅停止识别出的9000单元，确认端口释放；再检查隔离和配置。
4. 完整归档9000代码目录，包括Git、ignored本地文件及目录内数据；用tar compare核对。通过SQLite备份API备份**独立9000数据库**并校验完整性和迁移记录；生成SHA256清单。备份位置 `/var/backups/personaverse-staging/<UTC时间-随机后缀>/`，文件0600。
5. `git checkout --detach --no-overwrite-ignore` 固定SHA；不合并、不pull main、不git clean、不执行安装/build/migrate、不写环境变量。
6. 启动同一个9000单元，验证本地适配器和真实HTTPS入口。核对8000 PID/启动时间/目录/执行文件未变。
7. 常规命令失败、检查失败及SIGINT/SIGTERM/SIGHUP会尝试停止9000、恢复原提交及原分支（分支未被外部移动时）、启动并复查会话健康。**不自动还原数据库或环境文件**；回滚代码与数据库schema相同。恢复失败输出CRITICAL和备份路径并停止，不碰8000。

脚本不会修改监听地址、防火墙、反向代理、systemd配置或生产数据库。预发布服务重启可能维护SQLite WAL/SHM等运行文件；不会执行业务DML/DDL。部署期间请勿同时编辑代码、环境文件、代理配置或管理后台。

断电、磁盘损坏、SIGKILL或systemd自身故障无法由进程内异常处理保证恢复；保留完整备份供人工处理。备份含秘密和会话数据，仅限root，不要上传GitHub或聊天。不提供盲目还原数据库的命令。

## 自动验收与人工验收边界

自动验收包括：

- 会话API 200、数据库就绪、管理员已配置、AI关闭；
- 未登录访问管理API为401，非法Cookie不建立身份；
- 畸形密码字段返回400，发生在login_attempts/session写入之前；**不提交真实密码，也不通过错误真实密码消耗登录限流**；
- 跨来源登录请求403，保留CSRF/同源防护；
- 无Cookie退出接口返回200并清除带HttpOnly、Secure、SameSite=Strict等属性的Cookie；
- 首页、后台页面和修复JS实际可读；不请求任何聊天或模型接口。

这些检查不能证明真实账号登录成功。部署成功后，需要你本人在iPhone Safari中访问**预发布APP_ORIGIN**的 `/admin.html`：输入已有账号→确认出现后台列表→刷新仍登录→退出→刷新回到登录表单。不要在验证中编辑/删除人格或上传账号凭据。真实账号登录/退出本身会正常写入预发布sessions/login_attempts表；如果当前连预发布会话写入也未授权，请先不做该人工步骤。

如果仍失败，只提供HTTP状态、固定错误code及脱敏requestId。不得关闭CSRF/同源验证、把VERCEL设为1或通过改Cookie安全属性绕过问题。
