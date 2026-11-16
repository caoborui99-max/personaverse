import { mockRengineProvider } from '../apps/api/src/auth-providers/rengine.ts';
import { deliverLocalMail } from './local-mail-transport.ts';
import { hash, verify } from './argon-wasm.ts';
import { createFetchApp } from '../apps/api/src/fetch-app.ts';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { registerDatabaseApp } from '../apps/api/src/database-routes.ts';
export default {
  async fetch(
    request: Request,
    env: {
      TEST_DATABASE_URL: string;
      WEB_ORIGIN: string;
      LEGACY_ANON_REGRESSION?: string;
      RENGINE_MOCK?: string;
      LOCAL_MAIL_URL?: string;
      LOCAL_MAIL_CAPABILITY?: string;
      LOCAL_GENERATION?: string;
    },
    ctx: { waitUntil: (promise: Promise<unknown>) => void },
  ) {
    // This entry point is deliberately local-only. Match the real browser origin
    // when testing Secure/__Host- cookies, without relaxing production policy.
    const origin = new URL(env.WEB_ORIGIN);
    if (
      origin.hostname !== '127.0.0.1' ||
      origin.port !== '4320' ||
      !['http:', 'https:'].includes(origin.protocol) ||
      origin.origin !== env.WEB_ORIGIN
    )
      return Response.json({ error: { code: 'LOCAL_ORIGIN_ONLY' } }, { status: 503 });
    const url = new URL(env.TEST_DATABASE_URL);
    if (
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.pathname !== '/personaverse_v2_test'
    )
      return Response.json({ error: { code: 'LOCAL_TEST_ONLY' } }, { status: 503 });
    const schema = url.searchParams.get('schema') ?? 'public';
    url.searchParams.delete('schema');
    if (!/^(?:public|pv_[a-z0-9_]+)$/.test(schema))
      return Response.json({ error: { code: 'INVALID_LOCAL_SCHEMA' } }, { status: 503 });
    if (new URL(request.url).pathname === '/__local/runtime')
      return Response.json({
        generation: env.LOCAL_GENERATION ?? 'initial',
        secureCookies: origin.protocol === 'https:',
      });
    const adapter = new PrismaPg(
      {
        connectionString: url.toString(),
        max: 2,
        options: '-c search_path=' + schema,
        connectionTimeoutMillis: 2000,
        statement_timeout: 10000,
        query_timeout: 3000,
        idleTimeoutMillis: 1000,
      },
      { schema },
    );
    const db = new PrismaClient({ adapter });
    if (new URL(request.url).pathname === '/__local/probe') {
      const results: Record<string, unknown> = {};
      try {
        results.database = await db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT 1`;
          const c = await tx.aiControl.findUnique({ where: { id: 'global' } });
          return { connected: true, aiDisabled: c?.fakeEnabled === false };
        });
      } catch (e) {
        results.database = { error: e instanceof Error ? e.name : 'error' };
      } finally {
        await db.$disconnect();
      }
      const start = performance.now();
      try {
        const encoded = await hash('LOCAL SYNTHETIC TEST');
        results.argon = {
          verified: await verify(encoded, 'LOCAL SYNTHETIC TEST'),
          elapsedMs: Math.round(performance.now() - start),
        };
      } catch (e) {
        results.argon = { error: e instanceof Error ? e.message : 'error' };
      }
      return Response.json(results);
    }
    const app = createFetchApp();
    registerDatabaseApp(app.registration(), {
      db,
      externalProvider: env.RENGINE_MOCK === '1' ? mockRengineProvider() : undefined,
      legacyAnonymousTestMode: env.LEGACY_ANON_REGRESSION === '1',
      mailSender:
        env.LOCAL_MAIL_URL && env.LOCAL_MAIL_CAPABILITY
          ? {
              async send(message) {
                await deliverLocalMail(env.LOCAL_MAIL_URL!, env.LOCAL_MAIL_CAPABILITY!, message);
              },
            }
          : undefined,
      config: {
        environment: 'test',
        databaseUrl: env.TEST_DATABASE_URL,
        origin: env.WEB_ORIGIN,
        secure: origin.protocol === 'https:',
      },
    });
    try {
      await app.ready();
      const response = await app.fetch(request);
      const bytes = await response.arrayBuffer();
      return new Response(bytes, { status: response.status, headers: response.headers });
    } finally {
      ctx.waitUntil(app.close());
    }
  },
};
