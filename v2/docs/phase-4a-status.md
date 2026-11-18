# PersonaVerse Phase 4A 本地交付状态

2026-11-13。分支 `feat/v2-minimal-mobile-ui`，基线 `1833fc8f4c3358ee65812302611f8091c793f5af`。只创建本地提交，不推送、不 PR、不合并、不部署。

## 分别验收

- **工作流 A / Cloudflare：阻断。** OpenNext 目标构建和 Wrangler 本地启动完成，Service Binding 可达，Prisma 无 Rust 引擎真实 PostgreSQL 事务查询通过。Fastify 路由器动态代码生成、Argon2 候选动态 WASM 编译分别被 workerd 拒绝；完整管理后台无法安全运行，不能上线。保留最小复现，不为适配放宽安全。
- **工作流 B / 费用安全底座：通过本轮 Fake + 本地 PostgreSQL 范围。** 已实现并实测原子预算、持久化限流、幂等/fencing、不可变账本、未知结果保留、并发恢复、派发前关闭/下架复核。真实 Provider 不存在，默认关闭，零预算，无 Key 配置或收费 API 调用。真实供应商效果和外部 exactly-once 不在通过范围。
- **第四阶段 A 整体验收未完成，第四阶段 B 不应直接开始真实接入。** 先审核本地代码并修复 Cloudflare 阻断。

## 实际开发

新增可独立生成的 Prisma workerd 客户端、pg adapter 入口、官方 HTTP 桥接候选、OpenNext 独立配置、私有 Web→API Service Binding、本地构建/启动/验收命令。保留 Node 开发、原生 Argon2、原 Prisma generator 与既有页面。

新增 SQL `0005_ai_safety`：请求与固定会话/版本的复合关联、使用记录与请求/会话复合 FK；预算、预留、hold、价格、安全事件、持久计数与追加账本；状态机、幂等唯一键、每会话活跃请求唯一、不可变历史与同币种保护；旧请求/费用存在时明确事务失败。

新增 SQL `0006_ai_ledger_precision`：金额与既有 Decimal(18,8) 范围一致，hold 关联不可更新或删除。历史 0001—0004 未修改。未对任意旧数据自动回填，不生成或覆盖站长人格。

模拟聊天新增关闭接口和事务内状态复核、持久技术限流；并发创建访客会话锁定身份；活跃费用请求阻止普通 mock 写消息。管理员仍不套用访客日预算，必要的技术安全边界保留。

费用服务采用全局控制行及会话/预算行锁，预算检查和预留同事务完成。派发重复请求只有一个获得执行授权；未知结果不免费释放，不重试外部执行；恢复使用事务互斥和 fencing；对账只追加账目。详情见 [预算设计](ai-budget-design.md)。

## 测试与环境

本轮 Node 自动化 **107 通过、0 最终失败、3 TODO**；本地 Workers 独立检查 **2 通过、8 失败**。合计 **109 通过、8 失败、3 TODO**，另有 12 组 Workers 深度验证受阻未完成。没有将构建成功冒充运行成功，也没有继承上一阶段 68 项数字。

环境：Node 24.22.1、pnpm 11.25.0、Linux Chromium；官方固定 digest PostgreSQL 16.16，本地回环随机端口、tmpfs、随机测试凭据、每套测试随机隔离 schema、迁移重放后清理。未连接远程数据库。

执行命令和详细结果见 [测试矩阵](ai-safety-test-matrix.md)。TypeScript/Web/Workers 边界类型、格式、Prisma validate/schema diff、API/Next 与实际 OpenNext 目标构建均单列检查。依赖离线 frozen 安装通过。诊断阶段出现的沙箱回环权限、nullable 类型和默认表达式 drift 已修复/重跑；Workers 的两个真实兼容错误仍保留。

未验证：12 组 Workers 深度集成、真实 Hyperdrive、生产最小权限账户、线上 CPU/内存/配额、真机 Safari、备份恢复和真实供应商计费。静态 WASM、无动态 eval 的路由入口、恢复调度、对账权限/告警、真实 token 计价仍需后续工作。

## 本地使用

```sh
cd v2
pnpm install --frozen-lockfile
pnpm db:test:start
# 测试只使用自动生成的 .env.test.local，禁止替换为云端/生产 URL。
pnpm test:database
pnpm build
pnpm test:e2e
pnpm test:database:e2e
pnpm cf:client
pnpm cf:build
pnpm cf:dev
# 另一个终端：当前有真实阻断，命令将失败。
pnpm cf:verify
```

默认 Node 模拟预览继续使用 `pnpm dev`，回环 Web 4310 / API 4311；数据库模式需按原开发文档配置明确的本地开发环境，管理员初始化继续使用原安全交互命令，不提供默认密码。费用实验不由开发启动自动开启。`pnpm ai:recover:test` 只操作隔离本地测试库，不联网。

## 安全与 Git 边界

所有仓库变更限定 `v2/`，未修改 main、备份或其他分支；未更改旧版、服务器、生产库、Nginx/systemd、旧端口、GitHub/Cloudflare 设置。Wrangler 只执行本地 dev 和构建，没有远程发布或云资源创建。未请求、读取或提交真实 AI Key；模拟 Provider 不访问模型网络。

敏感信息检查覆盖本次变更、新文档、暂存列表与提交内容；本地随机数据库配置、Wrangler .dev.vars、生成客户端、bundle、测试截图/报告均忽略，不提交测试凭据。没有修改历史迁移。没有推送或触发远程 Actions。

## 本轮文件清单

- `v2/.gitignore`
- `v2/.prettierignore`
- `v2/apps/api/src/ai/engine.ts`
- `v2/apps/api/src/ai/fake-provider.ts`
- `v2/apps/api/src/ai/resources.ts`
- `v2/apps/api/src/ai/routes.ts`
- `v2/apps/api/src/chat.ts`
- `v2/apps/api/src/database-app.ts`
- `v2/apps/web/open-next.config.ts`
- `v2/apps/web/package.json`
- `v2/apps/web/src/lib/server-api.ts`
- `v2/cloudflare/api-worker.ts`
- `v2/cloudflare/api/wrangler.jsonc`
- `v2/cloudflare/argon-wasm.ts`
- `v2/cloudflare/runtime.d.ts`
- `v2/cloudflare/tsconfig.json`
- `v2/cloudflare/web-worker.ts`
- `v2/cloudflare/web.jsonc`
- `v2/database/migrations/0005_ai_safety/migration.sql`
- `v2/database/migrations/0006_ai_ledger_precision/migration.sql`
- `v2/database/schema.prisma`
- `v2/docs/ai-budget-design.md`
- `v2/docs/ai-safety-test-matrix.md`
- `v2/docs/cloudflare-local-validation.md`
- `v2/docs/phase-4a-status.md`
- `v2/docs/phase-4b-readiness.md`
- `v2/package.json`
- `v2/pnpm-lock.yaml`
- `v2/pnpm-workspace.yaml`
- `v2/scripts/ai-recover.ts`
- `v2/scripts/cf-local.mjs`
- `v2/scripts/generate-worker-client.mjs`
- `v2/scripts/validate-worker-local.mjs`
- `v2/tests/database/budget-preflight.test.ts`
- `v2/tests/database/budget.test.ts`
- `v2/tests/integration/argon-wasm.test.ts`
