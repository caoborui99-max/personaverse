import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createFetchApp } from '../../apps/api/src/fetch-app.ts';
import { registerDatabaseApp } from '../../apps/api/src/database-routes.ts';
import { withPasswordHasher, type PasswordNamespace } from '../argon-rpc.ts';
import { verifyBridge } from '../../packages/api-client/src/private-bridge.ts';
import { productionDatabase, productionOrigin } from './policy.ts';
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
        productionOrigin(env.WEB_ORIGIN);
        if (env.HYPERDRIVE_CACHE_DISABLED !== 'true')
          throw new Error('CACHE_CONFIRMATION_REQUIRED');
        const databaseUrl = productionDatabase(
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
    let stage = 'validate_origin';
    try {
      const origin = productionOrigin(env.WEB_ORIGIN);
      stage = 'validate_request_origin';
      if (new URL(request.url).origin !== origin) throw new Error('REQUEST_ORIGIN_MISMATCH');
      stage = 'validate_cache';
      if (env.HYPERDRIVE_CACHE_DISABLED !== 'true') throw new Error('CACHE_CONFIRMATION_REQUIRED');
      stage = 'verify_bridge';
      const ip = await verifyBridge(request, env.BRIDGE_SECRET);
      if (!ip) {
        console.error('PERSONAVERSE_API_FAILURE', {
          stage,
          reason: 'BRIDGE_PROOF_REJECTED',
          status: 403,
        });
        return Response.json({ error: { code: 'PRIVATE_BINDING_REQUIRED' } }, { status: 403 });
      }
      stage = 'validate_hyperdrive';
      const databaseUrl = productionDatabase(
        env.HYPERDRIVE.connectionString,
        env.PRODUCTION_DATABASE,
        env.PRODUCTION_ROLE,
      );
      stage = 'initialize_database';
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
      stage = 'register_routes';
      registerDatabaseApp(app.registration(), {
        db,
        deepseek:
          env.AI_ENABLED === 'true' ? new DeepSeekProvider(env.DEEPSEEK_API_KEY) : undefined,
        requireRealChat: true,
        mailSender: productionMail(env),
        config: { environment: 'production', databaseUrl, origin, secure: true },
      });
      try {
        stage = 'check_database_role';
        await assertProductionRole(
          (sql) => db.$queryRawUnsafe(sql),
          env.PRODUCTION_ROLE,
          env.PRODUCTION_DATABASE,
        );
        stage = 'serve_api';
        return await withPasswordHasher(env.PASSWORD_HASHERS, async () => {
          await app.ready();
          const response = await app.fetch(request);
          if (response.status >= 500)
            console.error('PERSONAVERSE_API_FAILURE', {
              stage,
              reason: 'API_RESPONSE_FAILURE',
              status: response.status,
            });
          return response;
        });
      } finally {
        ctx.waitUntil(app.close());
      }
    } catch (error) {
      // Deliberately log only a fixed stage and safe error class; never log error messages,
      // stack traces, connection strings, request bodies, headers, or credentials.
      const errorClass = error instanceof Error ? error.name : 'Unknown';
      const safeClass = ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AbortError'].includes(
        errorClass,
      )
        ? errorClass
        : 'Other';
      console.error('PERSONAVERSE_API_FAILURE', { stage, errorClass: safeClass });
      return Response.json(
        { error: { code: 'PRODUCTION_UNAVAILABLE', retryable: true } },
        { status: 503 },
      );
    }
  },
};
