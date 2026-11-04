# 本轮本地验证记录

基线 `c8d50927f295af97f1bf3ec8a7fdf410b90239a8`；独立分支 `prepare/deepseek-chat-release`，不合并main，不修改旧Sites。

2026-11-04 实际完成：

- 100个导入文件的Git blob SHA与GitHub提交逐一一致，原始Git树SHA亦一致。
- 修改前原7个测试文件通过。
- 修改后 `npm test` 的8个测试文件通过；含新增4组访客访问与真实Provider路径的Mock集成测试。测试进程预加载断网保护，实际环境密钥和数据库地址未传入测试子进程。
- `npm run build` 通过，构建仅输出前端并检查12个人格与服务端种子完全一致，不自动迁移数据库。
- `node scripts/check-preview.mjs --mirror` 通过，旧静态预览白名单、语法、无网络和两个副本保持一致。
- `git diff --check` 通过。
- 浏览器脚本Python语法检查通过。实际执行 `python3 tests/browser_smoke.py` 在创建本地socket阶段被环境拒绝：`PermissionError: [Errno 1] Operation not permitted`，未进入浏览器验证。未重试、未提升权限、未修改代理；没有生成手机截图，不能宣称手机或真实浏览器验收通过。

已准备GitHub离线CI和移动尺寸Mock浏览器脚本；远端运行结果应单独检查，不能由本地通过推定。无真实DeepSeek请求，无Neon/PostgreSQL实连验证，无Vercel部署，无生产数据库操作。首次API请求、免费测试部署及访客开放均等待用户确认。
