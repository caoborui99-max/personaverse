# 开发基线复核

2026-11-13 通过 git ls-remote 实际读取：

- main：317a99f8510514d8b094b1630293e52db7cecb91
- backup/pre-v2-rewrite-2026-11-12：8bd91fc04ae7b3eab2f82040c176ea209fe46130
- feat/v2-minimal-mobile-ui：8bd91fc04ae7b3eab2f82040c176ea209fe46130

使用 git clone --single-branch --branch feat/v2-minimal-mobile-ui 安全检出；初始工作区干净。没有重置、强推、合并或修改其他分支。本分支没有 .github 工作流、生产部署脚本或 package.json，旧版为根目录静态页面。未将更新后的 main 合并进来。

第一阶段抽查到其他分支包含 Node、SQLite/Neon、管理员认证、DeepSeek、部署模板与测试。这些不是已确认的生产运行版本。本工程不执行这些脚本、不自动迁移其数据库、不复制其正式人格或凭据。

所有新增文件限定在 v2/，不改根 README、.gitignore、旧版 HTML/CSS/JS。备份分支是静态版本备份，并非生产数据库备份。
