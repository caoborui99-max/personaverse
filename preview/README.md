# PersonaVerse Preview 0.1

独立静态移动端演示，复用现有首页、详情、样式、搜索、分类、排序、收藏与 12 个原创人格。聊天仅为分类预设脚本，页面始终标注非真实 AI；无注册、管理后台、支付、数据库、API 或外部资源请求。只保存非敏感的收藏人格 ID；聊天及提示词编辑不保存。浏览器清除网站数据会丢失收藏。

原服务器、AI Provider、部署配置均保留且未修改。本版本不是生产后端的替代品。

## 构建与检查

在仓库根目录运行（仅构建工具需要 Node.js，无第三方依赖；部署后的页面无需 Node.js）：

```sh
node scripts/build-preview.mjs
node scripts/check-preview.mjs
python3 tests/preview_browser.py
```

浏览器验收脚本需要 Python Playwright 与 `/usr/bin/chromium`，仅启动本机静态 HTTP 服务，不启动原后端，不调用 AI。产物已提交，手机用户无需执行命令。

- `preview-dist/`：独立可发布目录，所有页面/资源使用相对路径，支持子目录部署。
- `docs/preview/`：相同产物副本，方便 GitHub Pages 手机发布。
- 修改原 UI 或 `preview/` 后重新构建；不要直接编辑生成文件。
- 构建采用白名单复制，不读取任何环境变量或复制 `.env`、服务器、数据库、后台文件。检查器拒绝额外文件、API/网络/管理入口。
- 构建后检查两个产物副本逐字节一致。

## 实际验收

2026-11-04：构建成功；静态白名单、相对链接、JavaScript 语法、12 个完整人格检查通过。浏览器 60 项通过、0 项失败，覆盖两个部署子路径：人格列表、搜索、分类、排序、收藏刷新持久化、详情提示词、演示标识、HTML 输入安全、预设回复、聊天刷新清空、无效人格，以及 320/375/390/430/768/1440 像素下三个页面无横向溢出。无浏览器脚本错误，无 API 或外站请求。

未验证：真实 iPhone Safari、刘海屏安全区域真机表现、GitHub Pages 公网发布及中国大陆网络可达性。Chromium 模拟不等于 Safari 真机测试。无后台和真实 AI，不产生 API 费用。

## iPhone 最少发布步骤（本次未执行）

1. Safari 打开 GitHub 仓库 → Settings → Pages。菜单隐藏时可请求桌面网站。**先检查是否已有网站：若 Pages 已用于现有站点，停止，不替换其发布源。**
2. 没有现有 Pages 网站时，选择 Deploy from a branch → `preview/static-mobile-v01` → `/docs` → Save。公开仓库通常可免费使用 Pages，无需服务器、域名或美国手机号；GitHub 自身可能要求账号验证。此步骤会公开演示内容，请自行确认后操作。
3. 等待 GitHub 显示真实访问地址，在该地址后添加 `preview/`，用 Safari 打开。预计路径是 `https://caoborui99-max.github.io/personaverse/preview/`，**仅为待发布地址，本次未发布、未验证可访问**。第三方静态托管也可只上传 `preview-dist/`，不要上传整个项目或任何密钥。

如果需要保持已有 Pages 不变，另行选择独立静态站点后再发布；不要直接修改原站。此版本不需要填入任何 API Key，不要输入聊天或 GitHub 文件。
