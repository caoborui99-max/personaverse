import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { harness } from './harness.ts';
import { createFetchApp } from '../../apps/api/src/fetch-app.ts';
import { registerDatabaseApp } from '../../apps/api/src/database-routes.ts';
import { roleGrants } from '../../scripts/mock-preview-database.ts';
let h: Awaited<ReturnType<typeof harness>>, app: ReturnType<typeof createFetchApp>;
const origin = 'https://pv-web-mock-preview.test-account.workers.dev';
beforeAll(async () => {
  h = await harness();
  app = createFetchApp({ clientIp: '203.0.113.9' });
  registerDatabaseApp(app.registration(), {
    db: h.db,
    closedMockPreview: true,
    config: { environment: 'production', databaseUrl: 'unused', origin, secure: true },
  });
  await app.ready();
});
afterAll(async () => {
  await h?.close();
});
it.each(['register', 'verify', 'resend-verification', 'forgot-password', 'reset-password'])(
  'closed preview rejects %s with no mail/token mutation',
  async (path) => {
    const r = await app.fetch(
      new Request(origin + '/api/v1/auth/' + path, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    expect(r.status).toBe(503);
    expect((await r.json()).error.code).toBe('CLOSED_TEST_ONLY');
    expect(await h.db.emailVerification.count()).toBe(0);
    expect(await h.db.passwordReset.count()).toBe(0);
  },
);
it('retains CSRF preflight HTTPS Strict cookie and rejects foreign Origin', async () => {
  const r = await app.fetch(new Request(origin + '/api/v1/auth/csrf'));
  expect(r.status).toBe(200);
  const cookie = r.headers.get('set-cookie')!;
  for (const v of ['__Host-', 'Secure', 'HttpOnly', 'SameSite=Strict']) expect(cookie).toContain(v);
  expect(
    (
      await app.fetch(
        new Request(origin + '/api/v1/auth/login', {
          method: 'POST',
          headers: { origin: 'https://evil.invalid' },
        }),
      )
    ).status,
  ).toBe(403);
  expect((await app.fetch(new Request(origin + '/api/v1/admin/auth/session'))).status).toBe(401);
});
it('fails closed if budgets or AI flags are enabled', async () => {
  await h.db.aiControl.update({ where: { id: 'global' }, data: { fakeEnabled: true } });
  expect((await app.fetch(new Request(origin + '/api/v1/health'))).status).toBe(503);
  await h.db.aiControl.update({ where: { id: 'global' }, data: { fakeEnabled: false } });
  expect((await app.fetch(new Request(origin + '/api/v1/health'))).status).toBe(200);
});
it('actual PG app role cannot DDL, truncate, disable triggers, mutate budgets or own tables; transactions roll back', async () => {
  const role = 'pv_mock_app_' + randomBytes(8).toString('hex');
  const schema = h.schema;
  const root = new Client({ connectionString: process.env.DATABASE_URL });
  await root.connect();
  try {
    await root.query(`CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`);
    await root.query(roleGrants(schema, role));
    await root.query(`SET ROLE "${role}"`);
    expect((await root.query(`SELECT count(*) FROM "${schema}"."User"`)).rows).toHaveLength(1);
    for (const sql of [
      `CREATE TABLE "${schema}".forbidden(id int)`,
      `TRUNCATE "${schema}"."User"`,
      `ALTER TABLE "${schema}"."PersonaCoreVersion" DISABLE TRIGGER ALL`,
      `UPDATE "${schema}"."AiControl" SET "fakeEnabled"=true`,
      `DELETE FROM "${schema}"."AdminAuditLog"`,
    ])
      await expect(root.query(sql)).rejects.toMatchObject({ code: '42501' });
    await root.query('BEGIN');
    await root.query(
      `INSERT INTO "${schema}"."Category"(id,name,slug) VALUES(gen_random_uuid(),'test-only','rollback-role')`,
    );
    await root.query('ROLLBACK');
    expect(
      (
        await root.query(
          `SELECT count(*)::int n FROM "${schema}"."Category" WHERE slug='rollback-role'`,
        )
      ).rows[0].n,
    ).toBe(0);
  } finally {
    await root.query('RESET ROLE');
    await root.query(`DROP OWNED BY "${role}"`);
    await root.query(`DROP ROLE "${role}"`);
    await root.end();
  }
});
