import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createFetchApp } from '../../apps/api/src/fetch-app.ts';
import { registerDatabaseApp } from '../../apps/api/src/database-routes.ts';
import { withPasswordHasher, type PasswordNamespace } from '../argon-rpc.ts';
import { verifyBridge } from '../../packages/api-client/src/private-bridge.ts';
import { assertPreviewRole, previewDatabase, previewOrigin, previewPath } from './policy.ts';
type Env = {
  WEB_ORIGIN: string;
  BRIDGE_SECRET: string;
  HYPERDRIVE: { connectionString: string };
  PREVIEW_DATABASE: string;
  PREVIEW_ROLE: string;
  HYPERDRIVE_CACHE_DISABLED: string;
  PASSWORD_HASHERS: PasswordNamespace;
};
export default {
  async fetch(request: Request, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    if (!previewPath(request)) return new Response('Not found', { status: 404 });
    try {
      const origin = previewOrigin(env.WEB_ORIGIN);
      if (new URL(request.url).origin !== origin || env.HYPERDRIVE_CACHE_DISABLED !== 'true')
        throw new Error('PREVIEW_CONFIG_REQUIRED');
      const ip = await verifyBridge(request, env.BRIDGE_SECRET);
      if (!ip)
        return Response.json({ error: { code: 'PRIVATE_BINDING_REQUIRED' } }, { status: 403 });
      const databaseUrl = previewDatabase(
        env.HYPERDRIVE.connectionString,
        env.PREVIEW_DATABASE,
        env.PREVIEW_ROLE,
      );
      const db = new PrismaClient({
        adapter: new PrismaPg({
          connectionString: databaseUrl,
          max: 2,
          connectionTimeoutMillis: 10000,
          statement_timeout: 10000,
          idleTimeoutMillis: 1000,
        }),
        transactionOptions: { timeout: 10000 },
      });
      const app = createFetchApp({ clientIp: ip });
      registerDatabaseApp(app.registration(), {
        db,
        closedMockPreview: true,
        config: { environment: 'production', databaseUrl, origin, secure: true },
      });
      try {
        await assertPreviewRole(
          (sql) => db.$queryRawUnsafe(sql),
          env.PREVIEW_ROLE,
          env.PREVIEW_DATABASE,
        );
        return await withPasswordHasher(env.PASSWORD_HASHERS, async () => {
          await app.ready();
          return app.fetch(request);
        });
      } finally {
        ctx.waitUntil(app.close());
      }
    } catch {
      return Response.json(
        { error: { code: 'PREVIEW_UNAVAILABLE', retryable: true } },
        { status: 503 },
      );
    }
  },
};
