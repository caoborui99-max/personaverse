import type { PrismaClient } from '@prisma/client';
// Repeatable fixture initialization; never called by API startup or a production command.
export async function ensureTestDraft(db: PrismaClient) {
  if (process.env.APP_ENV !== 'test') throw new Error('Test environment required');
  const [row] = await db.$queryRaw<{ schema: string }[]>`SELECT current_schema() AS schema`;
  if (!row?.schema.startsWith('pv_'))
    throw new Error('Refusing fixture initialization outside a disposable test schema');
  const id = '00000000-0000-4000-8000-000000000099';
  return db.persona.upsert({
    where: { id },
    create: {
      id,
      name: 'TEST ONLY — 未发布测试草稿',
      slug: 'test-only-isolated-fixture',
      isTest: true,
    },
    update: {},
  });
}
