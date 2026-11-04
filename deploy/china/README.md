# 中国大陆低成本单机部署适配（未执行生产部署）

预算上限50元/月，优先腾讯云中国大陆轻量应用服务器，目标2核2GB。本仓库不购买资源、不保证任何促销价格；首购和续费、带宽/流量、系统盘、税费/额外收费以及未来域名/证书的分摊费用全部计入预算。年付即使月均低于50元，首笔实付超预算也要另行确认，不能擅自付款。若官方实际报价超过50元/月，停止，不自动升级配置或购买。无需另租数据库、面板、缓存或对象存储。

## 当前能力与限制

保留原生前端、Node24后端、管理员系统和AI Provider。单机持久SQLite使用内置node:sqlite，不依赖Neon联网；DATABASE_URL必须不设置。现有Neon适配继续保留作可选开发方案，但它不是普通国内PostgreSQL驱动。

SQLite方案运行和纯JS构建可直接使用Node24，无需为SQLite安装Neon依赖：`node scripts/build.js`、`node scripts/dev-server.js`。完整开发环境可`npm ci`。GitHub、Node下载站及npm在大陆的连通性未经验证；若下载不稳定，应使用可信来源生成并校验的发布包，不关闭TLS检查、不执行不明镜像安装脚本。不能用Node18代替Node24。

代码升级目录 /opt/personaverse/releases/<commit>，当前版本链接 /opt/personaverse/current；数据目录 /var/lib/personaverse；备份 /var/backups/personaverse；配置 /etc/personaverse/app.env；日志 /var/log/personaverse。后三者不得放到源码或public目录。更新代码不删除数据、配置、备份；旧版本先保留。一次只运行一个应用实例，暂不支持多机共享SQLite。

## iPhone操作路线（现在不需要购买或执行）

每次只完成一项，后续可由助手根据实际截图指导。以下是路线，不是要求一次完成所有步骤。

1. Safari打开腾讯云官网 → 登录 → 账号中心/实名认证。注册一般免费，实名认证以平台要求为准；不要发送身份证、手机号、密码或验证码到聊天。
2. 控制台 → 轻量应用服务器 → 购买/选购页面，仅查看大陆区域、2核2GB和续费/流量报价。查看不等于付款，报价超过预算就停。不要开启自动续费或试用转付费。本仓库没有购买动作。
3. 以后经你确认并拥有服务器后，服务器详情 → 官方登录/浏览器终端（以实际控制台界面为准）。初期仅使用私有测试：不开放8000、数据库端口或管理面板，不开放公开网站。SSH如需开放应限制来源IP；手机IP变化时先更新安全规则，不改成永久全网开放。
4. 在官方终端核对 `node --version` 为24.x，系统为有systemd的Linux。准备经核对的代码发布包及专用personaverse非root账号；终端有高权限风险，具体安装指令需要确认系统后再逐步给出。
5. 在控制台安全文件编辑器（如提供）或官方终端编辑器中，将本目录app.env.example复制为 /etc/personaverse/app.env，权限0600。密码只在你自己的云控制台填写，不写进命令行、聊天、Git或截图。填写ADMIN_EMAIL/ADMIN_PASSWORD（至少12字符），AI_ENABLED始终false，AI_API_KEY留空。没有默认管理员密码。应用不要求美国手机号，云平台认证以其实际页面为准。
6. 先运行数据库/备份自动测试与本机服务。APP_ORIGIN在正式HTTPS接入前可以是https://example.invalid供本机代理模拟测试，但它不是可访问域名或上线地址。不要因有示例配置就开放公网。
7. 拥有合法可用域名/证书并确认备案及服务合规前提后，才替换APP_ORIGIN、nginx.conf.example域名及证书路径。真实域名、备案、HTTPS和公网开放均需要你另行确认，本次不执行。域名无现成免费承诺，证书免费额度以供应商为准。
8. 配置验证通过后再启用服务。systemd/Nginx/system账户准备属于实际部署，有成本或安全影响，本次仅提供文件，不安装或启动。

## 生产SQLite和环境配置

必须同时设置 NODE_ENV=production、DATABASE_DRIVER=sqlite、绝对SQLITE_PATH（推荐 /var/lib/personaverse/personaverse.sqlite）、APP_ORIGIN=https://你的域名、TRUST_PROXY=loopback。不能设置DATABASE_URL或VERCEL来绕过检查。程序拒绝 /tmp、/var/tmp、/dev/shm、/run 及指向这些目录的父级符号链接；拒绝数据库文件自身的符号链接，数据库权限0600。目录仅专用账户可写，防止其他账户替换路径。

APP_ORIGIN是服务器可信固定来源，不从客户端Forwarded-Host计算。生产API只接受Host匹配的请求；在TRUST_PROXY=loopback时要求连接来自本机且X-Forwarded-Proto匹配。Nginx应覆盖这些头而不是拼接不可信值。Node始终仅监听127.0.0.1；禁止直接对公网绑定0.0.0.0。HTTPS让同源校验和Secure Cookie一致，不通过设置VERCEL=1伪装环境。

## systemd、自动重启与日志

提供 personaverse.service：专用账户，UMask0077、只写数据/日志目录、PrivateTmp、ProtectSystem、ProtectHome、768MB内存上限，失败5秒后重启，SIGTERM优雅关闭。目标是给2GB机器留出Nginx与系统余量；并非已完成压力测试。

管理员/部署操作者未来需确认 /usr/local/bin/node 或 /usr/bin/node 为Node24；代码目录专用账户只读。创建 /var/lib/personaverse、/var/log/personaverse、/var/backups/personaverse，所有者personaverse，权限0700。环境文件由root保护，systemd读取后注入进程。不要让Web进程以root运行。

将核对过的service复制至 /etc/systemd/system 后，才可由你执行daemon-reload、enable/start。本次不执行这些部署命令。服务备份定时器每日03:15附近执行、补跑错过任务，不含AI凭据。

日志只记录状态与异常类型，不记录消息、密码、Key。提供logrotate.conf，放 /etc/logrotate.d/personaverse 后由系统logrotate调度：每日检查、maxsize2M、保留5份、压缩、copytruncate。大小阈值仅在调度时生效，不是实时磁盘硬上限；copytruncate可能丢失极少量轮转窗口日志。要监控磁盘余量，不宣称绝不会写满。

## 一致性备份和不覆盖恢复

工具 scripts/sqlite-maintenance.js 使用SQLite在线backup API，不直接复制正在使用的主库而遗漏WAL。备份文件/清单0600、目录0700；校验SHA256/大小、SQLite integrity_check，再复制到独立临时目录验证恢复。哈希用于发现损坏，不是防恶意篡改的签名。备份包含会话/聊天等敏感数据，当前未加密，只能留在受保护目录；异机导出前应另行确认加密和访问控制，不公开下载。

命令（未来在你的服务器执行，路径替换为真实值）：
- `SQLITE_PATH=/var/lib/personaverse/personaverse.sqlite BACKUP_DIR=/var/backups/personaverse node scripts/sqlite-maintenance.js backup`
- `node scripts/sqlite-maintenance.js verify /var/backups/personaverse/某次备份.sqlite`
- `node scripts/sqlite-maintenance.js restore /var/backups/personaverse/某次备份.sqlite /var/lib/personaverse/restored-new.sqlite`

恢复目标已存在时必定拒绝；不会覆盖在线主库。需要真正切换恢复时，先停应用、保留当前库及WAL相关文件、验证新库、经用户确认后将SQLITE_PATH指向新库，再启动验证。不要直接覆盖或删除当前库。服务重启/备份均无AI调用。

不自动删除任何旧备份。请根据磁盘容量定期检查与下载/加密保存异机副本；手机控制台是否支持文件传输需核实。只有本机备份不能防整台服务器/账号丢失；异机灾备本轮未实施，不假称已完成。云快照/对象存储可能额外收费，不能自动开通。

## AI安全

本轮不配置真实Key。systemd使用start-single-server.js入口，强制要求NODE_ENV=production、AI_ENABLED=false，否则拒绝启动。app.env示例为AI_ENABLED=false，真实AI开关不因备份/迁移/启动自动开启。Mock测试里的测试占位值不是真实Key。正式前如何测试供应商需另行授权；此次不执行任何收费请求。国内网络连通性、供应商主体资质/内容审核/数据流向和ICP备案仍需人工核实，安装到大陆不代表已合规上线。

## 验证边界

本地自动测试覆盖生产持久路径、临时路径/符号链接拒绝、HTTPS可信代理/Host/Origin、WAL在线备份、恢复不覆盖、校验失败拒绝与重开数据保留。原业务/Mock测试和构建需以本轮实际结果为准。systemd静态verify不等于真实服务启动；Nginx -t、真实TLS、logrotate实际轮转、腾讯云实机、iPhoneSafari、国内连通性和负载性能均需在后续私有服务器验收。未购买/部署/合并。
