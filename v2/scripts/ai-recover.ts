import { PrismaClient } from '@prisma/client';
import { BudgetEngine } from '../apps/api/src/ai/engine.ts';
import { databaseConfig } from '../apps/api/src/config.ts';
const config = databaseConfig();
const url = new URL(config.databaseUrl);
if (
  config.environment !== 'test' ||
  url.pathname !== '/personaverse_v2_test' ||
  !['127.0.0.1', 'localhost'].includes(url.hostname)
)
  throw new Error('Isolated local test database required');
const db = new PrismaClient();
try {
  console.log(JSON.stringify({ recovered: await new BudgetEngine(db).recover(), simulated: true }));
} finally {
  await db.$disconnect();
}
