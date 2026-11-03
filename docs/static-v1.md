# 人格宇宙 PersonaVerse

一个面向手机用户的 DeepSeek 虚拟人格提示词平台。采用原生 HTML、CSS、JavaScript，无框架、无构建步骤、无第三方依赖，可作为纯静态网站免费部署到 GitHub Pages。

源码仓库：[caoborui99-max/personaverse](https://github.com/caoborui99-max/personaverse)。当前版本**未部署、未购买任何服务**。本地浏览和继续开发不需要持续连接 GitHub。

## 第一版功能

- 深色宇宙主题首页与响应式布局。
- 12 个内置人格、精选卡片、5 种分类。
- 按人格名称、英文名、标签和描述搜索，支持组合分类筛选及名称排序。
- 独立人格详情页、完整提示词、对话开场白。
- 提示词可临时编辑，一键复制后粘贴到 DeepSeek 新对话中使用。
- 当前浏览器内收藏、使用指南、无结果提示与无效人格链接提示。
- 手机底部导航、精选人格横向浏览、键盘焦点样式与减少动态效果设置。

本项目提供提示词，不直接连接 DeepSeek API，也不提供站内 AI 聊天。使用时不需要 API 密钥。点击「前往 DeepSeek」才会打开 DeepSeek 官方网站；平台不会自动发送提示词或对话内容。

## 本地预览

直接使用浏览器打开 `index.html` 即可浏览。建议通过本地 HTTP 服务预览，以获得更稳定的剪贴板和本地存储行为：

```bash
cd /workspace/sites/personaverse
python3 -m http.server 8000
```

然后访问：

- 首页：`http://localhost:8000/`
- 人格详情示例：`http://localhost:8000/persona.html?id=moonlight`
- 收藏：`http://localhost:8000/index.html?view=favorites`
- 分类示例：`http://localhost:8000/index.html?category=学习成长`

在自己的电脑上运行时，将 `cd` 后的路径改为项目所在目录。结束预览时在终端按 `Ctrl + C`。

复制优先使用浏览器剪贴板 API；浏览器拒绝时会尝试兼容方式，并在无法自动复制时提示手动操作。手机浏览远程地址时，通常需要 HTTPS 才能稳定使用剪贴板 API；GitHub Pages 提供 HTTPS。

## 文件结构

```text
personaverse/
├── index.html          # 首页入口
├── persona.html        # 人格详情入口，通过 ?id= 选择人格
├── .nojekyll           # GitHub Pages 直接按静态文件提供服务
├── .gitignore
├── README.md
├── assets/
│   └── favicon.svg     # 本地图标
├── css/
│   └── style.css       # 深色主题、布局与手机适配
└── js/
    ├── personas.js     # 人格数据和完整提示词
    └── app.js          # 渲染、搜索、分类、收藏与复制
```

所有站内资源使用相对路径，适用于 `https://用户名.github.io/仓库名/` 这样的 GitHub Pages 项目子路径。详情页使用实际的 `persona.html` 文件，无需服务器路由或重写规则。

## 数据与编辑

收藏保存在当前浏览器的 `localStorage`，键名为 `personaverse-favorites`。收藏不会跨设备同步；清除浏览器站点数据后会被删除。浏览器禁用存储时，本次浏览仍可操作收藏，但无法持久保存。

详情页内修改提示词只影响当前页面，**不会自动保存**。刷新或离开页面前，请复制需要保留的内容。要永久修改内置人格，请编辑 `js/personas.js`。

在 `window.PERSONAS` 数组中添加以下结构的对象即可新增人格：

```javascript
{
  id: 'unique-persona-id', // 必须唯一，用于详情页链接
  name: '人格名称',
  englishName: 'Persona',
  category: '创意灵感',
  tagline: '一句简洁的人格介绍。',
  description: '说明人格能帮助用户做什么，以及适合的对话场景。',
  tags: ['标签一', '标签二', '标签三'],
  icon: 'spark',
  accent: 'purple',
  featured: false,
  prompt: `【你的角色】
完整的提示词内容。

【开始对话】
指定人格应如何回应用户。`,
  starters: ['开场白一', '开场白二', '开场白三']
}
```

分类使用：`情感陪伴`、`效率工具`、`学习成长`、`创意灵感`、`趣味角色`。若要增加分类，还需同步修改 `js/app.js` 中的分类列表和图标映射。

可用图标：`moon`、`spark`、`compass`、`pen`、`code`、`book`、`coffee`、`music`、`leaf`、`planet`。可用强调色：`purple`、`cyan`、`rose`、`amber`、`green`、`blue`。首页最多展示数组中前三个 `featured: true` 的精选人格。

## 以后免费部署到 GitHub Pages

以下仅为后续操作说明，本次没有执行：

当前仓库保持私有。本次未更改仓库可见性；以后使用 GitHub Free 的 Pages 时，需要由你决定是否将仓库设为公开。

1. 在 GitHub 创建一个公开仓库，例如 `personaverse`。免费账户可使用公开仓库的 GitHub Pages。
2. 将**本目录中的文件**上传到仓库根目录，确保根目录直接包含 `index.html`、`persona.html`、`css/`、`js/`、`assets/` 和 `.nojekyll`。不要把整个 `personaverse` 目录再嵌套上传一层。
3. 打开仓库的 **Settings → Pages**，将发布来源设为 **Deploy from a branch**。
4. 选择存放文件的分支（通常是 `main`）和根目录 **`/ (root)`**，保存。
5. 等待 GitHub 构建完成后，使用 Pages 设置中给出的 HTTPS 地址访问。

无需付费主机、数据库、域名或 GitHub Actions 构建配置。需要发布时，再连接 GitHub 或手动上传即可。

## 基础检查

如果本机安装了 Node.js，可检查 JavaScript 语法：

```bash
node --check js/personas.js
node --check js/app.js
```

浏览器验收时，建议检查分类与搜索组合、收藏后刷新、详情链接直接打开、编辑后复制、复制受限时的提示，以及不同手机宽度下的布局。
