# 第三阶段文件清单

所有仓库变更均在 v2/ 内；构建产物、依赖、凭据、本地配置和截图不提交。

## 已有文件变更

```text
M	v2/.env.example
M	v2/README.md
M	v2/apps/api/package.json
M	v2/apps/api/src/server.ts
M	v2/apps/web/src/app/admin/login/page.tsx
D	v2/apps/web/src/app/admin/page.tsx
M	v2/apps/web/src/app/chat/[slug]/page.tsx
M	v2/apps/web/src/app/explore/page.tsx
M	v2/apps/web/src/app/globals.css
M	v2/apps/web/src/app/layout.tsx
M	v2/apps/web/src/app/page.tsx
M	v2/apps/web/src/app/persona/[slug]/page.tsx
M	v2/apps/web/src/components/chat-panel.tsx
M	v2/apps/web/src/components/explore-browser.tsx
M	v2/apps/web/src/components/persona-card.tsx
M	v2/apps/web/src/components/storage-ui.tsx
M	v2/database/schema.prisma
M	v2/docs/anonymous-chat.md
M	v2/docs/api-contract.md
M	v2/docs/architecture.md
M	v2/docs/authentication.md
M	v2/docs/data-model.md
M	v2/docs/openapi.json
M	v2/package.json
M	v2/packages/api-client/package.json
M	v2/packages/api-client/src/index.ts
M	v2/packages/shared/src/index.ts
M	v2/playwright.config.ts
M	v2/pnpm-lock.yaml
M	v2/scripts/generate-openapi.ts
M	v2/tests/integration/auth.pending.test.ts
M	v2/vitest.config.ts
```

D 标记的 v2/apps/web/src/app/admin/page.tsx 已迁入受保护路由组，URL 仍为 /admin。

## 新增文件

```text
v2/apps/api/src/auth.ts
v2/apps/api/src/chat.ts
v2/apps/api/src/config.ts
v2/apps/api/src/database-app.ts
v2/apps/api/src/errors.ts
v2/apps/api/src/personas.ts
v2/apps/web/src/app/admin/(protected)/layout.tsx
v2/apps/web/src/app/admin/(protected)/page.tsx
v2/apps/web/src/app/admin/(protected)/personas/[id]/edit/page.tsx
v2/apps/web/src/app/admin/(protected)/personas/[id]/preview/page.tsx
v2/apps/web/src/app/admin/(protected)/personas/[id]/versions/page.tsx
v2/apps/web/src/app/admin/(protected)/personas/new/page.tsx
v2/apps/web/src/app/admin/(protected)/personas/page.tsx
v2/apps/web/src/components/admin-login.tsx
v2/apps/web/src/components/admin-workspace.tsx
v2/apps/web/src/lib/server-api.ts
v2/database/migrations/0002_admin_content/migration.sql
v2/database/migrations/0003_published_slug/migration.sql
v2/docs/phase-3-files.md
v2/docs/phase-3-status.md
v2/packages/api-client/src/admin.ts
v2/playwright.database.config.ts
v2/scripts/database-browser.ts
v2/scripts/database.mjs
v2/scripts/dev.mjs
v2/scripts/init-admin.ts
v2/scripts/seed-test.ts
v2/scripts/test-postgres.mjs
v2/tests/database/constraints.test.ts
v2/tests/database/harness.ts
v2/tests/database/system.test.ts
v2/tests/e2e-database/admin.spec.ts
v2/tests/integration/config.test.ts
v2/vitest.database.config.ts
```
