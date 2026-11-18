# PostgreSQL、迁移与不可变版本

## 实际迁移

0001_foundation 保持原样。0002_admin_content 增加管理员角色/认证版本、人格 revision/标签/isTest、持久化登录限流；移除非空 core CHECK，使空白草稿也能按原文存版本。完整内容仅在明确发布动作中校验，不自动填补。

0003_published_slug 增加独立唯一的已发布 slug；保存草稿修改 slug 不会改变公开入口。显式发布切换公开 slug，旧聊天继续绑定原内核版本。

Prisma Schema 现在显式表达原 SQL 中的草稿/发布/恢复复合外键与使用请求关联。真实 PostgreSQL 迁移后与 datamodel diff 为零；CHECK 和触发器仍由 SQL 维护，禁止 db push 丢失它们。

## 关系与完整性

管理员 → 会话/版本/审计/测试聊天。人格 → 多个内核版本；人格与分类多对多；聊天固定关联人格及其内核版本；所有者恰为 adminId、visitorId 之一。消息按会话序号排序且客户端消息 ID/角色联合唯一。

数据库约束阻止跨人格草稿、发布、恢复和聊天版本引用，保护标准化唯一邮箱、唯一 slug、令牌摘要及非负额度。isTest 人格不能发布。内核版本和审计 UPDATE/DELETE 被触发器拒绝。

coreText 完整原文单独存储，不 trim、不重写、不覆盖。openingMessage 与相关档案快照一起不可变保存。每次保存草稿追加版本；恢复旧版追加新版本并记录 restoredFromId。安全归档保留全部历史与已有聊天外键，不提供破坏性删除。

## 并发与事务

保存、分类关联、版本创建、草稿指针和审计在同一个事务中完成。先以 expectedRevision 比较并更新 revision（CAS），同时保存者只能一个成功，另一个 409；失败事务回滚修订号及所有新记录。发布、下架、归档、恢复同样受 revision 约束。

公开内容来自 publishedVersion.profileSnapshot，不从当前草稿姓名、故事或分类关系推导。修改草稿不会泄露未发布改动。发布新版本不更新 ChatSession.coreVersionId。

## 隔离测试与清理

官方 PostgreSQL 16 容器、随机密码/回环端口、tmpfs 数据。测试在同一隔离数据库中创建 pv*constraints*_/pv*system*_/pv*browser*_ 随机 schema，每次从零重放迁移；finally/afterAll 删除各自 schema。测试初始化只允许 APP*ENV=test + pv*_ schema，使用固定测试 UUID 的 upsert(update:{})，不会覆盖作者内容或发布数据。

Prisma 的可空复合版本关联与主键共享 id，创建 Persona 时显式生成 UUID，避免 ORM 省略主键造成 NULL。API、初始化和测试均采取此方式。

已执行的约束和事务测试结果见 phase-3-status.md。没有访问生产数据库；数据库备份恢复演练仍是下一阶段任务。

## 3.1 增量保护

0004 新增聊天四字段不可变触发器、发布指针对/slug 格式/已发布状态 CHECK、快照结构与所属版本校验、事务局部发布意图 guard。历史 0001–0003 未修改，Prisma 模型未新增实体，额外规则保留于 SQL。

迁移显式 BEGIN/COMMIT。旧数据不符合新规则时失败并整体回滚，不代替作者补全原文或静默下架。迁移前需由站长审查异常记录，再独立批准数据修复；不可更改已执行迁移的校验和。

发布 guard 不识别业务管理员，API 身份/权限/Origin/CSRF 是授权边界。应用数据库账户和迁移账户未来必须分离，应用不得拥有 DDL/禁用触发器权限。本地隔离测试为了重放迁移使用独立测试库所有者，不等于生产最小权限配置已经验收。
