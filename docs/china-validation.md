# 中国大陆单机适配实施报告（2026-11-04）

独立分支 deploy/cn-single-server，基于 phase2/ai-provider-minimum；原页面、Provider与原有分支保留。未购买、未部署、未合并、未调用收费AI。

## 已实现

- 明确DATABASE_DRIVER=sqlite及生产绝对持久化SQLITE_PATH；拒绝临时目录、指向临时目录的父路径符号链接、数据库文件符号链接和Serverless SQLite；禁止SQLite与DATABASE_URL混用。
- APP_ORIGIN固定HTTPS来源、仅信任loopback代理、Host及协议一致性校验，保留同源保护和Secure Cookie。
- 专用非root账户systemd模板、失败重启、受限文件写权限、日志轮转模板。
- SQLite在线一致性备份、SHA256/大小/完整性检查、独立恢复验证，恢复目标存在时拒绝，不覆盖当前库。
- 单机入口强制AI_ENABLED=false，启用真实AI开关时拒绝启动；保留原Provider。
- iPhone官方云控制台路线、50元/月预算约束及私有验收步骤；不增加数据库或面板月租。

## 实际验证

- node tests/china.test.js：4通过、0失败。
- node tests/mvp.test.js：5通过、0失败。
- node tests/ai.test.js：5通过、0失败，纯Mock，无收费调用。
- npm test：3测试文件通过；逐项用上面命令核对14组。
- npm run build：通过；此处没有配置Neon，构建输出明确提示，与生产SQLite服务启动迁移分开。
- python3 -u tests/proxy_smoke.py：通过，实际启动生产SQLite单机入口，验证本机HTTP模拟HTTPS代理、登录Secure Cookie、跨域/Host/协议拒绝及AI关闭。不是实际Nginx TLS验证。
- python3 -u tests/browser_smoke.py：5个Chromium场景通过，4种视口。不是实体iPhone Safari验证。
- systemd-analyze verify deploy/china/personaverse.service deploy/china/personaverse-backup.service deploy/china/personaverse-backup.timer：最终退出0，无输出；只验证静态配置，不代表服务已安装或启动。初次无网络沙箱权限时受SO_PASSCRED限制，授权本机测试权限后复验通过。
- git diff --check：通过。

## 未验证/限制

当前环境未安装Nginx/logrotate，未执行nginx -t和logrotate实际轮转。真实systemd启动、腾讯云机器、证书域名/备案、iPhone Safari、大陆访问与2GB资源压力未验证。没有采购价格确认；若2核2GB的实际首购/续费等合计超过50元/月应停止。

备份当前未加密，必须保留在0700/0600受限路径；哈希不是防恶意篡改签名。异机加密备份及灾备尚未完成；自动清理旧备份未启用，需关注磁盘余量。单机磁盘故障不能靠同盘备份解决。不支持SQLite多机横向写入。

可交付的是单机适配代码、配置模板和本地验证结果；不宣称已部署、已备案或可直接公开运营。后续由用户确认服务器、主体/合规条件后，先做私有实机验收。
