import { mockRengineProvider } from './auth-providers/rengine.ts';
import { localFileMail } from './node-local-mail.ts';
import { buildApp } from './app.ts';
import { buildDatabaseApp } from './database-app.ts';
const port = Number(process.env.API_PORT ?? 4311);
const host = process.env.API_HOST ?? '127.0.0.1';
if (host !== '127.0.0.1' || !Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Use a loopback host and an unprivileged development port.');
if (process.env.APP_ENV === 'production' && process.env.PV_MODE === 'mock-regression')
  throw new Error('Mock regression mode cannot run in production');
const app =
  process.env.PV_MODE === 'mock-regression'
    ? buildApp({ origin: process.env.WEB_ORIGIN ?? 'http://127.0.0.1:4310' })
    : buildDatabaseApp({
        externalProvider:
          process.env.APP_ENV === 'test' && process.env.PV_RENGINE_MOCK === '1'
            ? mockRengineProvider()
            : undefined,
        mailSender:
          process.env.PV_LOCAL_MAIL === '1' &&
          ['test', 'development'].includes(process.env.APP_ENV ?? '')
            ? localFileMail(process.env.APP_ENV!)
            : undefined,
      });
await app.listen({ host, port });
console.log(`PersonaVerse API listening on http://${host}:${port}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
