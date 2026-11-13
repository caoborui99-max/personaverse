# PostgreSQL 数据模型

schema.prisma 定义管理员账户/会话、人格/内核版本、分类与关联、匿名访客、聊天会话/消息、请求幂等、AI 使用、额度桶及审计。

关系：管理员 1:N 会话、内核版本、测试聊天、审计；人格 1:N 不可变内核版本；人格 N:M 分类；聊天 N:1 人格及其内核版本，所有者只能为管理员/匿名访客之一；聊天 1:N 消息/请求/使用记录。

主键为 UUID。邮箱规范化且唯一，slug 唯一，令牌摘要唯一。消息按会话序号排序；角色与客户端消息 ID 联合唯一。版本按人格与版本号唯一。索引覆盖状态列表、分类查询、会话所有者、到期清理及审计对象。

## 内容保护

coreText 是独立 TEXT 字段，不能自动生成、trim、截断或覆盖。profileSnapshot 保存站长当时提交的档案内容。首次正式录入由站长完成；没有正式 seed。

迁移 SQL 增加 Prisma 不支持的 CHECK、复合版本归属外键及不可变触发器：

- UPDATE/DELETE PersonaCoreVersion 一律拒绝；恢复操作 INSERT 新版本并记录 restoredFromId。
- 草稿/发布指针必须属于本人格；发布必须有版本。
- 聊天内核版本与人格必须对应。
- ChatSession 恰有一个所有者。
- 使用量与费用不能为负。
- 审计追加，不允许更新/删除。

draftVersionId、publishedVersionId、restoredFromId 与使用请求关联的额外约束保留在 SQL 中，Prisma schema 无法完整表达全部数据库约束。后续必须审查迁移 SQL，禁止使用 db push 绕过触发器与手写约束。

版本记录只 INSERT，后台恢复不回写旧记录。历史聊天固定 coreVersionId；发布新版本不静默改变旧会话。下架阻止访客创建/继续聊天的正式策略留待业务实现。

本阶段仅做 Prisma 语法校验与离线 SQL 生成，没有连接 PostgreSQL，没有执行迁移或恢复演练。真实数据库约束运行测试为 todo，不能宣称通过。
