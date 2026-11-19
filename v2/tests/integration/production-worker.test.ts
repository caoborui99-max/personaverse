import { it, expect, vi, beforeEach } from 'vitest';
const fake = vi.hoisted(() => ({
  db: {
    $disconnect: vi.fn(async () => {}),
    $queryRawUnsafe: vi.fn(),
    persona: { findMany: vi.fn() },
    category: { findMany: vi.fn() },
  },
  connect: vi.fn(),
}));
vi.mock('@prisma/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@prisma/client')>();
  return {
    ...actual,
    PrismaClient: class {
      constructor() {
        fake.connect();
        return fake.db;
      }
    },
  };
});
import worker from '../../cloudflare/production/api.ts';
import { privateApiRequest } from '../../packages/api-client/src/service-request.ts';
const origin = 'https://pv-web-production.test-account.workers.dev';
const secret = 'synthetic-bridge-secret-32-bytes-minimum';
const env = {
  WEB_ORIGIN: origin,
  BRIDGE_SECRET: secret,
  AI_ENABLED: 'false',
  DEEPSEEK_API_KEY: '',
  RESEND_API_KEY: '',
  MAIL_FROM: '',
  HYPERDRIVE: { connectionString: 'postgresql://personaverse_app:synthetic@127.0.0.1:1/neondb' },
  PRODUCTION_DATABASE: 'neondb',
  PRODUCTION_ROLE: 'personaverse_app',
  HYPERDRIVE_CACHE_DISABLED: 'true',
  PASSWORD_HASHERS: {
    getByName() {
      throw Error('Password RPC must not run for public catalogue');
    },
  },
};
const pending: Promise<unknown>[] = [];
const ctx = {
  waitUntil(p: Promise<unknown>) {
    pending.push(p);
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  fake.db.$queryRawUnsafe.mockResolvedValue([
    { role: 'personaverse_app', database: 'neondb', privileged: false },
  ]);
  fake.db.persona.findMany.mockResolvedValue([]);
  fake.db.category.findMany.mockResolvedValue([]);
});
it('runs the actual production API registration, role guard and catalogue after signed SSR origin conversion', async () => {
  const r = await privateApiRequest('http://127.0.0.1:4311/api/v1/personas', {}, origin, secret);
  const response = await worker.fetch(r, env, ctx);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ mode: 'database', items: [] });
  expect(fake.db.$queryRawUnsafe).toHaveBeenCalledOnce();
  await Promise.all(pending.splice(0));
  expect(fake.db.$disconnect).toHaveBeenCalled();
});
it('rejects retained development ports, unsigned or mismatched proofs, and cache misconfiguration before database access', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const good = await privateApiRequest(
      'http://localhost:4311/api/v1/personas',
      {},
      origin,
      secret,
    );
    expect(
      (await worker.fetch(new Request(origin + ':4311/api/v1/personas', good), env, ctx)).status,
    ).toBe(503);
    expect((await worker.fetch(new Request(origin + '/api/v1/personas'), env, ctx)).status).toBe(
      403,
    );
    expect(
      (await worker.fetch(good, { ...env, BRIDGE_SECRET: secret + 'wrong' }, ctx)).status,
    ).toBe(403);
    expect(
      (await worker.fetch(good, { ...env, HYPERDRIVE_CACHE_DISABLED: 'false' }, ctx)).status,
    ).toBe(503);
    expect(fake.connect).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
  }
});
it('keeps least-privilege failures closed and logs only a fixed stage, never exception detail', async () => {
  fake.db.$queryRawUnsafe.mockRejectedValue(Error('SYNTHETIC_PRIVATE_SQL_DETAIL'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const r = await privateApiRequest('http://localhost:4311/api/v1/personas', {}, origin, secret);
    const response = await worker.fetch(r, env, ctx);
    expect(response.status).toBe(503);
    expect(log).toHaveBeenCalledWith('PERSONAVERSE_API_FAILURE', {
      stage: 'check_database_role',
      errorClass: 'Error',
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('SYNTHETIC_PRIVATE_SQL_DETAIL');
    expect(fake.db.persona.findMany).not.toHaveBeenCalled();
    await Promise.all(pending.splice(0));
  } finally {
    log.mockRestore();
  }
});
it('records route-level database 503 responses that do not throw out of the transport', async () => {
  fake.db.persona.findMany.mockRejectedValue(
    Object.assign(Error('SYNTHETIC_PRIVATE_SQL_DETAIL'), {
      name: 'DriverAdapterError',
      cause: { originalCode: '08006' },
    }),
  );
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const r = await privateApiRequest('http://localhost:4311/api/v1/personas', {}, origin, secret);
    const response = await worker.fetch(r, env, ctx);
    expect(response.status).toBe(503);
    expect(log).toHaveBeenCalledWith('PERSONAVERSE_API_FAILURE', {
      stage: 'serve_api',
      reason: 'API_RESPONSE_FAILURE',
      status: 503,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('SYNTHETIC_PRIVATE_SQL_DETAIL');
    expect(await response.text()).not.toContain('SYNTHETIC_PRIVATE_SQL_DETAIL');
    await Promise.all(pending.splice(0));
  } finally {
    log.mockRestore();
  }
});
