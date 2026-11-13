import { expect, it } from 'vitest';
import { databaseConfig } from '../../apps/api/src/config.ts';
it('refuses ambiguous environments, remote development databases and insecure production origins', () => {
  expect(() => databaseConfig({})).toThrow();
  expect(() =>
    databaseConfig({
      APP_ENV: 'development',
      DATABASE_URL: 'postgresql://placeholder@remote.invalid/personaverse_v2_dev',
    }),
  ).toThrow();
  expect(() =>
    databaseConfig({
      APP_ENV: 'test',
      DATABASE_URL: 'postgresql://placeholder@127.0.0.1/production',
    }),
  ).toThrow();
  expect(() =>
    databaseConfig({
      APP_ENV: 'production',
      DATABASE_URL: 'postgresql://placeholder@remote.invalid/personaverse',
      WEB_ORIGIN: 'http://example.invalid',
      DATABASE_SAFETY_CONFIRMATION: 'personaverse-v2-production',
    }),
  ).toThrow();
});
