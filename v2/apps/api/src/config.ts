import { z } from 'zod';
export type DatabaseConfig = {
  environment: 'development' | 'test' | 'production';
  databaseUrl: string;
  origin: string;
  secure: boolean;
};
export function databaseConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const environment = z.enum(['development', 'test', 'production']).parse(env.APP_ENV);
  const databaseUrl = z.string().url().parse(env.DATABASE_URL);
  const url = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('PostgreSQL is required');
  if (
    environment !== 'production' &&
    (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      !url.pathname.startsWith('/personaverse_v2_' + (environment === 'test' ? 'test' : 'dev')))
  )
    throw new Error('Isolated local database required');
  if (
    environment === 'production' &&
    env.DATABASE_SAFETY_CONFIRMATION !== 'personaverse-v2-production'
  )
    throw new Error('Explicit production database confirmation required');
  const origin = env.WEB_ORIGIN ?? 'http://127.0.0.1:4310';
  if (new URL(origin).origin !== origin) throw new Error('WEB_ORIGIN must be an exact origin');
  if (environment === 'production' && !origin.startsWith('https:'))
    throw new Error('Production requires HTTPS');
  return { environment, databaseUrl, origin, secure: origin.startsWith('https:') };
}
