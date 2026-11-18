import { Client } from 'pg';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { PrismaClient } from '@prisma/client';
import { Email, Password, passwordHash } from '../apps/api/src/auth.ts';
export function target(env: NodeJS.ProcessEnv) {
  const u = new URL(env.PREVIEW_MIGRATION_URL ?? 'postgresql://invalid');
  if (
    env.APP_ENV !== 'mock-preview' ||
    !/^pv_mock_[a-z0-9_]+$/.test(u.pathname.slice(1)) ||
    !u.username.startsWith('pv_mock_migrator_') ||
    !['postgres:', 'postgresql:'].includes(u.protocol) ||
    u.searchParams.get('sslmode') !== 'verify-full' ||
    u.hostname !== env.PREVIEW_CONFIRMED_HOST ||
    u.pathname.slice(1) !== env.PREVIEW_CONFIRMED_DATABASE ||
    /(?:localhost|127\.0\.0\.1|hyperdrive|pooler)/i.test(u.hostname)
  )
    throw new Error('Explicit dedicated direct TLS test target required');
  return u;
}
export function roleGrants(schema: string, role: string) {
  if (!/^(public|pv_[a-z0-9_]+)$/.test(schema) || !/^pv_mock_app_[a-z0-9_]+$/.test(role))
    throw new Error('Invalid role/schema');
  const s = `"${schema}"`,
    r = `"${role}"`;
  const immutable = [
    'PersonaCoreVersion',
    'AdminAuditLog',
    'AiPrice',
    'AiUsageRecord',
    'AiLedgerEntry',
    'AiSafetyEvent',
    'AiHold',
  ];
  return `REVOKE ALL ON SCHEMA ${s} FROM PUBLIC; GRANT USAGE ON SCHEMA ${s} TO ${r};
REVOKE ALL ON ALL TABLES IN SCHEMA ${s} FROM ${r};
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${s} TO ${r};
REVOKE ALL ON ${s}."_prisma_migrations" FROM ${r};
REVOKE UPDATE, DELETE ON ${immutable.map((t) => `${s}."${t}"`).join(',')} FROM ${r};
REVOKE INSERT, UPDATE, DELETE ON ${['AiControl', 'AiBudget', 'AiPrice', 'AiReservation', 'AiHold', 'AiLedgerEntry', 'AiUsageRecord', 'AiSafetyEvent'].map((t) => `${s}."${t}"`).join(',')} FROM ${r};`;
}
async function hidden(label: string) {
  process.stdout.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise<string>((resolve, reject) => {
    let value = '';
    function done() {
      process.stdin.off('data', data);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    }
    function data(chunk: Buffer) {
      for (const c of chunk.toString()) {
        if (c === '\u0003') {
          done();
          reject(new Error('Cancelled'));
          return;
        }
        if (c === '\r' || c === '\n') {
          done();
          resolve(value);
          return;
        }
        if (c === '\u007f') value = value.slice(0, -1);
        else if (c >= ' ') value += c;
      }
    }
    process.stdin.on('data', data);
  });
}
async function main() {
  const u = target(process.env);
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error('Interactive target confirmation required');
  let rl = createInterface({ input: process.stdin, output: process.stdout });
  if (
    (await rl.question(
      `Dedicated TEST database ${u.hostname}/${u.pathname.slice(1)}. Type its full host/database: `,
    )) !==
    u.hostname + u.pathname
  )
    throw new Error('Target mismatch');
  const action = process.argv[2];
  rl.close();
  if (action === 'migrate') {
    const result = spawnSync(
      process.execPath,
      [
        'node_modules/prisma/build/index.js',
        'migrate',
        'deploy',
        '--schema',
        'database/schema.prisma',
      ],
      {
        env: { ...process.env, DATABASE_URL: u.toString(), CHECKPOINT_DISABLE: '1' },
        stdio: 'pipe',
      },
    );
    // Prisma output may contain a URL: never relay it.
    if (result.status !== 0)
      throw new Error(
        'Migration failed; inspect privately. Do not automatically reset or resolve.',
      );
    console.log(
      'Migration command completed; separately verify replay, checksums, constraints and role tests.',
    );
    return;
  }
  if (action === 'role') {
    const role = process.env.PREVIEW_APP_ROLE ?? '';
    const grants = roleGrants('public', role);
    const client = new Client({ connectionString: u.toString() });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`,
      );
      await client.query(grants);
      await client.query('COMMIT');
      console.log(
        'Restricted NOLOGIN role created. Set a password using psql \\password, then explicitly enable LOGIN; never pass plaintext passwords in SQL or command arguments.',
      );
    } catch {
      await client.query('ROLLBACK');
      throw new Error('Role creation failed; existing roles are never overwritten');
    } finally {
      await client.end();
    }
    return;
  }
  if (action !== 'owner' && action !== 'tester')
    throw new Error('Expected migrate/role/owner/tester');
  rl = createInterface({ input: process.stdin, output: process.stdout });
  const email = Email.parse(await rl.question('Synthetic test email (@test.invalid): '));
  if (!email.endsWith('@test.invalid'))
    throw new Error('Only synthetic closed test accounts allowed');
  if (
    action === 'tester' &&
    (await rl.question('Type OFFLINE-TEST-IDENTITY-CONFIRMED: ')) !==
      'OFFLINE-TEST-IDENTITY-CONFIRMED'
  )
    throw new Error('Test identity not confirmed');
  rl.close();
  const password = Password.parse(await hidden('Account password (hidden): '));
  if (password !== (await hidden('Confirm password: '))) throw new Error('Password mismatch');
  const db = new PrismaClient({ datasources: { db: { url: u.toString() } } });
  try {
    const hash = await passwordHash(password);
    if (action === 'tester')
      await db.user.create({
        data: {
          email,
          passwordHash: hash,
          emailVerifiedAt: new Date(),
          displayName: '封闭测试账号',
        },
      });
    else
      await db.$transaction(async (tx) => {
        const admin = await tx.adminAccount.create({
          data: { email, passwordHash: hash, role: 'owner' },
        });
        await tx.adminAuditLog.create({
          data: {
            adminId: admin.id,
            action: 'initialize-closed-test-owner',
            objectType: 'authentication',
            requestId: crypto.randomUUID(),
            changeSummary: {},
          },
        });
      });
    console.log(
      'Synthetic account created; no real email sent. Existing accounts are never overwritten.',
    );
  } finally {
    await db.$disconnect();
  }
}
if (process.argv[1]?.endsWith('mock-preview-database.ts'))
  main().catch(() => {
    console.error('Dedicated test operation failed (details withheld).');
    process.exitCode = 1;
  });
