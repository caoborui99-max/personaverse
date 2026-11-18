import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { passwordHash } from '../apps/api/src/auth.ts';
const directory = resolve('.local-preview');
const statePath = resolve(directory, 'private-state.json');
type ProcessRecord = { pid: number; start: string };
type State = {
  schema: string;
  databaseUrl: string;
  owner: { email: string; password: string };
  viewer: { email: string; password: string };
  api?: ProcessRecord;
  web?: ProcessRecord;
};
const action = process.argv[2];
const origin = 'http://127.0.0.1:4310',
  api = 'http://127.0.0.1:4311';
function save(s: State) {
  writeFileSync(statePath, JSON.stringify(s, null, 2), { mode: 0o600 });
}
function state() {
  return JSON.parse(readFileSync(statePath, 'utf8')) as State;
}
function isolated(url: string) {
  const parsed = new URL(url);
  if (
    !['127.0.0.1', 'localhost'].includes(parsed.hostname) ||
    parsed.pathname !== '/personaverse_v2_test' ||
    !/^pv_runtime_[a-f0-9]+$/.test(parsed.searchParams.get('schema') ?? '')
  )
    throw new Error('Isolated preview schema required');
}
function tick(pid: number) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]!;
  } catch {
    return '';
  }
}
function owned(p?: ProcessRecord) {
  return !!p && !!p.start && tick(p.pid) === p.start;
}
async function waitFor(run: () => Promise<boolean>, label: string, timeout = 60000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await run()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Preview readiness timeout: ' + label);
}
async function healthy(url: string) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}
async function free(url: string) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1000) });
  } catch (e) {
    if (e instanceof TypeError && String(e.cause).includes('ECONNREFUSED')) return;
    throw new Error('Unable to confirm local port is free');
  }
  throw new Error('Refusing to replace a service already using the preview port');
}
function env(s: State) {
  isolated(s.databaseUrl);
  return {
    ...process.env,
    APP_ENV: 'test',
    PV_MODE: 'database',
    DATABASE_URL: s.databaseUrl,
    WEB_ORIGIN: origin,
    API_INTERNAL_URL: api,
    API_HOST: '127.0.0.1',
    API_PORT: '4311',
    PV_RENGINE_MOCK: '0',
    PV_LEGACY_ANON_REGRESSION: '0',
    PV_LOCAL_MAIL: '1',
    PV_LOCAL_MAIL_DIR: resolve(directory, 'mail'),
    NEXT_TELEMETRY_DISABLED: '1',
    PV_WORKERS_ADAPTER: '',
  };
}
function launch(s: State, kind: 'api' | 'web') {
  const fd = openSync(resolve(directory, kind + '.log'), 'a', 0o600);
  const args =
    kind === 'api'
      ? [resolve('apps/api/dist/apps/api/src/server.js')]
      : [
          resolve('apps/web/node_modules/next/dist/bin/next'),
          'start',
          '--hostname',
          '127.0.0.1',
          '--port',
          '4310',
        ];
  try {
    const child = spawn(process.execPath, args, {
      cwd: resolve('apps', kind === 'api' ? 'api' : 'web'),
      env: env(s),
      detached: true,
      stdio: ['ignore', fd, fd],
    });
    if (!child.pid) throw new Error('Preview process failed to start');
    child.unref();
    s[kind] = { pid: child.pid, start: tick(child.pid) };
    if (!s[kind]!.start) throw new Error('Unable to record owned preview process');
    save(s);
  } finally {
    closeSync(fd);
  }
}
async function stop(s: State, kind: 'api' | 'web') {
  const p = s[kind];
  if (p && tick(p.pid) && !owned(p)) throw new Error('Refusing to signal an unrelated reused PID');
  if (owned(p)) {
    process.kill(p!.pid, 'SIGTERM');
    // Confirm the actual listener has closed; a reaped/detached child may remain a zombie briefly.
    await waitFor(
      async () => !(await healthy(kind === 'api' ? api + '/api/v1/health' : origin)),
      'stop ' + kind,
      15000,
    );
  }
  delete s[kind];
  save(s);
}
if (action === 'prepare') {
  if (existsSync(statePath))
    throw new Error('Preview already prepared; preserving existing records and credentials');
  process.loadEnvFile('.env.test.local');
  if (process.env.APP_ENV !== 'test') throw new Error('Explicit test environment required');
  const parsed = new URL(process.env.DATABASE_URL!);
  if (
    !['127.0.0.1', 'localhost'].includes(parsed.hostname) ||
    parsed.pathname !== '/personaverse_v2_test'
  )
    throw new Error('Isolated PostgreSQL required');
  const schema = 'pv_runtime_' + randomUUID().replaceAll('-', '');
  const root = new PrismaClient();
  try {
    await root.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  } finally {
    await root.$disconnect();
  }
  parsed.searchParams.set('schema', schema);
  const s: State = {
    schema,
    databaseUrl: parsed.toString(),
    owner: {
      email: 'owner-' + randomUUID() + '@test.invalid',
      password: randomBytes(24).toString('hex'),
    },
    viewer: {
      email: 'viewer-' + randomUUID() + '@test.invalid',
      password: randomBytes(24).toString('hex'),
    },
  };
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const migration = spawnSync(process.execPath, ['scripts/database.mjs', 'migrate'], {
    env: env(s),
    stdio: 'pipe',
  });
  if (migration.status !== 0)
    throw new Error('Isolated migration failed; see explicit database migration checks');
  const db = new PrismaClient({ datasources: { db: { url: s.databaseUrl } } });
  try {
    await db.$transaction(async (tx) => {
      for (const role of ['owner', 'viewer'] as const)
        await tx.adminAccount.create({
          data: { email: s[role].email, passwordHash: await passwordHash(s[role].password), role },
        });
    });
  } finally {
    await db.$disconnect();
  }
  save(s);
  console.log(
    'Prepared isolated preview with migrations 0001–0009. Random TEST ONLY credentials in ' +
      statePath,
  );
} else if (action === 'start') {
  const s = state();
  isolated(s.databaseUrl);
  if (s.api || s.web)
    throw new Error('Preview has process records; use status/stop before starting again');
  await free(api + '/api/v1/health');
  await free(origin);
  try {
    launch(s, 'api');
    await waitFor(() => healthy(api + '/api/v1/health'), 'API');
    launch(s, 'web');
    await waitFor(() => healthy(origin), 'Web');
    console.log(
      'Preview ready: ' +
        origin +
        ' | API ' +
        api +
        '/api/v1/health (loopback only; Rengine OFF; deterministic mock chat).',
    );
  } catch (error) {
    await stop(s, 'web');
    await stop(s, 'api');
    throw error;
  }
} else if (action === 'restart-api') {
  const s = state();
  await stop(s, 'api');
  await free(api + '/api/v1/health');
  launch(s, 'api');
  await waitFor(() => healthy(api + '/api/v1/health'), 'API restart');
  console.log('Owned API restarted; database and sessions preserved.');
} else if (action === 'verify') {
  const s = state();
  isolated(s.databaseUrl);
  const db = new PrismaClient({ datasources: { db: { url: s.databaseUrl } } });
  try {
    const journey = JSON.parse(readFileSync(resolve(directory, 'journey-private.json'), 'utf8'));
    const migrations = await db.$queryRaw<
      {
        migration_name: string;
        checksum: string;
        finished_at: Date | null;
        rolled_back_at: Date | null;
      }[]
    >`SELECT migration_name,checksum,finished_at,rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name`;
    if (
      migrations.length !== 9 ||
      migrations.some(
        (m) =>
          !m.finished_at ||
          m.rolled_back_at ||
          m.checksum !==
            createHash('sha256')
              .update(
                readFileSync(resolve('database/migrations', m.migration_name, 'migration.sql')),
              )
              .digest('hex'),
      )
    )
      throw new Error('Migration history/checksum verification failed');
    const retained = await db.chatSession.findUniqueOrThrow({ where: { id: journey.retainedId } });
    const deleted = await db.chatSession.findUniqueOrThrow({ where: { id: journey.chatId } });
    const removed = await db.user.findUniqueOrThrow({ where: { id: journey.deletedUserId } });
    const accountChat = await db.chatSession.findUniqueOrThrow({
      where: { id: journey.deletedChatId },
    });
    const user = await db.user.findUniqueOrThrow({ where: { email: journey.user.email } });
    const versions = await db.personaCoreVersion.findMany({
      where: { personaId: journey.personaId },
    });
    const controls = await db.aiControl.findUniqueOrThrow({ where: { id: 'global' } });
    const result = {
      migrations: migrations.map((m) => m.migration_name),
      retainedChatOwned: retained.userId === user.id && !retained.deletedAt,
      retainedMessages: await db.chatMessage.count({ where: { sessionId: retained.id } }),
      deletedChatTombstone: !!deleted.deletedAt,
      deletedChatMessages: await db.chatMessage.count({ where: { sessionId: deleted.id } }),
      removedAccountDisabled: removed.status === 'deleted',
      removedAccountSessions: await db.userSession.count({
        where: { userId: removed.id, revokedAt: null },
      }),
      removedAccountChatTombstone: !!accountChat.deletedAt,
      removedAccountMessages: await db.chatMessage.count({ where: { sessionId: accountChat.id } }),
      currentUserFavorites: await db.userFavorite.count({ where: { userId: user.id } }),
      originalCorePreserved:
        versions.length > 0 && versions.every((v) => v.coreText === journey.core),
      externalIdentityCount: await db.externalIdentity.count(),
      externalTransactionCount: await db.externalAuthTransaction.count(),
      feeExecutionEnabled: controls.fakeEnabled,
      maxRequestUnits: controls.maxRequestUnits.toString(),
      positiveBudgetCount: await db.aiBudget.count({ where: { limitUnits: { gt: 0 } } }),
      ledgerCount: await db.aiLedgerEntry.count(),
    };
    if (
      !result.retainedChatOwned ||
      result.retainedMessages !== 6 ||
      !result.deletedChatTombstone ||
      result.deletedChatMessages !== 0 ||
      !result.removedAccountDisabled ||
      result.removedAccountSessions !== 0 ||
      !result.removedAccountChatTombstone ||
      result.removedAccountMessages !== 0 ||
      result.currentUserFavorites !== 1 ||
      !result.originalCorePreserved ||
      result.externalIdentityCount !== 0 ||
      result.externalTransactionCount !== 0 ||
      result.feeExecutionEnabled ||
      result.maxRequestUnits !== '0' ||
      result.positiveBudgetCount !== 0 ||
      result.ledgerCount !== 0
    )
      throw new Error('Runtime database invariants failed');
    writeFileSync(
      resolve(directory, 'database-verification.json'),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await db.$disconnect();
  }
} else if (action === 'stop') {
  const s = state();
  await stop(s, 'web');
  await stop(s, 'api');
  console.log('Owned local preview stopped; isolated data preserved.');
} else if (action === 'status') {
  const s = state();
  const result = {
    webHealthy: await healthy(origin),
    apiHealthy: await healthy(api + '/api/v1/health'),
    webOwned: owned(s.web),
    apiOwned: owned(s.api),
    webUrl: origin,
    apiUrl: api,
  };
  console.log(JSON.stringify(result));
  if (!result.webHealthy || !result.apiHealthy || !result.webOwned || !result.apiOwned)
    process.exitCode = 1;
} else
  throw new Error(
    'Allowed actions: prepare/start/status/verify/restart-api/stop. No deployment operation exists.',
  );
