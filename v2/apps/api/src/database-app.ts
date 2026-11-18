import Fastify from 'fastify';
import { registerDatabaseApp } from './database-routes.ts';
export function buildDatabaseApp(options: Parameters<typeof registerDatabaseApp>[1] = {}) {
  return registerDatabaseApp(
    Fastify({ logger: false, bodyLimit: 2_200_000, requestTimeout: 20000, trustProxy: false }),
    options,
  );
}
