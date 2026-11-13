import { hash, verify } from './argon-wasm.ts';
import { httpServerHandler } from 'cloudflare:node';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { buildDatabaseApp } from '../apps/api/src/database-app.ts';
export default {
  async fetch(request: Request, env: { TEST_DATABASE_URL: string; WEB_ORIGIN: string }) {
    const url = new URL(env.TEST_DATABASE_URL);
    if (
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.pathname !== '/personaverse_v2_test'
    )
      return Response.json({ error: { code: 'LOCAL_TEST_ONLY' } }, { status: 503 });
    const schema = url.searchParams.get('schema') ?? 'public';
    url.searchParams.delete('schema');
    const adapter = new PrismaPg(
      {
        connectionString: url.toString(),
        max: 2,
        connectionTimeoutMillis: 2000,
        statement_timeout: 10000,
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
    let app;
    try {
      app = buildDatabaseApp({
        db,
        config: {
          environment: 'test',
          databaseUrl: env.TEST_DATABASE_URL,
          origin: env.WEB_ORIGIN,
          secure: false,
        },
      });
    } catch {
      await db.$disconnect();
      return Response.json(
        {
          error: {
            code: 'WORKERS_COMPATIBILITY_BLOCKED',
            message: 'Fastify dynamic code generation is unsupported in workerd.',
            requestId: 'local-worker-compatibility',
            retryable: false,
          },
        },
        { status: 503 },
      );
    }
    try {
      await app.ready();
      const handler = httpServerHandler(app.server);
      const response = await handler.fetch(request);
      const bytes = await response.arrayBuffer();
      return new Response(bytes, { status: response.status, headers: response.headers });
    } finally {
      await app.close();
    }
  },
};
