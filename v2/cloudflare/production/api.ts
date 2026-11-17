import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createFetchApp } from '../../apps/api/src/fetch-app.ts';
import { registerDatabaseApp } from '../../apps/api/src/database-routes.ts';
import { withPasswordHasher, type PasswordNamespace } from '../argon-rpc.ts';
import { verifyBridge } from '../../packages/api-client/src/private-bridge.ts';
import {
  productionDatabase as previewDatabase,
  productionOrigin as previewOrigin,
} from './policy.ts';
import { previewPath } from '../mock-preview/policy.ts';
import { assertProductionRole } from './policy.ts';
import { DeepSeekProvider } from '../../apps/api/src/ai/deepseek.ts';
import { BudgetEngine } from '../../apps/api/src/ai/engine.ts';
import { productionMail } from './mail.ts';
type Env = {
  AI_ENABLED: string;
  DEEPSEEK_API_KEY: string;
  RESEND_API_KEY: string;
  MAIL_FROM: string;
  WEB_ORIGIN: string;
  BRIDGE_SECRET: string;
  HYPERDRIVE: { connectionString: string };
  PRODUCTION_DATABASE: string;
  PRODUCTION_ROLE: string;
  HYPERDRIVE_CACHE_DISABLED: string;
  PASSWORD_HASHERS: PasswordNamespace;
};
export default {
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(
      (async () => {
        previewOrigin(env.WEB_ORIGIN);
        if (env.HYPERDRIVE_CACHE_DISABLED !== 'true')
          throw new Error('CACHE_CONFIRMATION_REQUIRED');
        const databaseUrl = previewDatabase(
          env.HYPERDRIVE.connectionString,
          env.PRODUCTION_DATABASE,
          env.PRODUCTION_ROLE,
        );
        const db = new PrismaClient({
          adapter: new PrismaPg({
            connectionString: databaseUrl,
            max: 1,
            connectionTimeoutMillis: 10000,
            statement_timeout: 10000,
          }),
          transactionOptions: { timeout: 10000 },
        });
        try {
          await assertProductionRole(
            (sql) => db.$queryRawUnsafe(sql),
            env.PRODUCTION_ROLE,
            env.PRODUCTION_DATABASE,
          );
          await new BudgetEngine(db).recover();
        } finally {
          await db.$disconnect();
        }
      })(),
    );
  },
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
        env.PRODUCTION_DATABASE,
        env.PRODUCTION_ROLE,
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
        deepseek:
          env.AI_ENABLED === 'true' ? new DeepSeekProvider(env.DEEPSEEK_API_KEY) : undefined,
        requireRealChat: true,
        mailSender: productionMail(env),
        config: { environment: 'production', databaseUrl, origin, secure: true },
      });
      try {
        await assertProductionRole(
          (sql) => db.$queryRawUnsafe(sql),
          env.PRODUCTION_ROLE,
          env.PRODUCTION_DATABASE,
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
        { error: { code: 'PRODUCTION_UNAVAILABLE', retryable: true } },
        { status: 503 },
      );
    }
  },
};
