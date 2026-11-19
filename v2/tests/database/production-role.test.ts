import { it, expect } from 'vitest';
import { Client } from 'pg';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { assertProductionRole } from '../../cloudflare/production/policy.ts';
it('real isolated PostgreSQL enforces the production role preflight without granting budget control or schema creation', async () => {
  const source = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid');
  if (
    process.env.APP_ENV !== 'test' ||
    !['127.0.0.1', 'localhost'].includes(source.hostname) ||
    source.pathname !== '/personaverse_v2_test'
  )
    throw Error('Isolated loopback test database required');
  const suffix = randomBytes(8).toString('hex');
  const database = 'personaverse_v2_test_chain_' + suffix,
    role = 'pv_chain_app_' + suffix;
  const root = new Client({ connectionString: source.toString() });
  await root.connect();
  let target: Client | undefined;
  try {
    await root.query(`CREATE DATABASE "${database}"`);
    source.pathname = '/' + database;
    const migration = spawnSync(process.execPath, ['scripts/database.mjs', 'migrate'], {
      env: { ...process.env, DATABASE_URL: source.toString() },
      encoding: 'utf8',
    });
    expect(migration.status).toBe(0);
    target = new Client({ connectionString: source.toString() });
    await target.connect();
    await target.query(
      `CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`,
    );
    await target.query(
      `REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO "${role}"; GRANT SELECT ON public."AiControl",public."AiBudget",public."Persona" TO "${role}"; GRANT UPDATE("circuitOpen","reason") ON public."AiControl" TO "${role}"; GRANT UPDATE("reservedUnits","spentUnits") ON public."AiBudget" TO "${role}"`,
    );
    await target.query(`SET ROLE "${role}"`);
    const read = async (sql: string) => (await target!.query(sql)).rows;
    await expect(assertProductionRole(read, role, database)).resolves.toBeUndefined();
    expect((await target.query('SELECT count(*)::int n FROM public."Persona"')).rows[0].n).toBe(0);
    await expect(
      target.query('UPDATE public."AiControl" SET "maxRequestUnits"=1'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(target.query('CREATE TABLE public.forbidden(id int)')).rejects.toMatchObject({
      code: '42501',
    });
    await target.query('RESET ROLE');
    await target.query(`GRANT UPDATE("limitUnits") ON public."AiBudget" TO "${role}"`);
    await target.query(`SET ROLE "${role}"`);
    await expect(assertProductionRole(read, role, database)).rejects.toThrow(
      'LEAST_PRIVILEGE_ROLE_REQUIRED',
    );
  } finally {
    if (target) {
      await target.query('RESET ROLE').catch(() => {});
      await target.end();
    }
    // Names are fresh per-test; only this task's disposable database/role are removed.
    await root.query(`DROP DATABASE IF EXISTS "${database}"`);
    await root.query(`DROP ROLE IF EXISTS "${role}"`);
    await root.end();
  }
}, 30000);
