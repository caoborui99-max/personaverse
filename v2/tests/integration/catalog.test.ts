import { it, expect } from 'vitest';
import { loadCatalog, loadExplore } from '../../apps/web/src/lib/catalog.ts';
const empty = { mode: 'database' as const, items: [], total: 0, page: 1, limit: 12 };
it('distinguishes a real empty catalogue from rejected or unavailable API data', async () => {
  expect(await loadCatalog(async () => empty)).toEqual({ data: empty, unavailable: false });
  expect(
    await loadCatalog(async () => {
      throw Error('503');
    }),
  ).toEqual({ data: null, unavailable: true });
});
it('retains available personas when only categories fail', async () => {
  expect(
    await loadExplore(
      async () => empty,
      async () => {
        throw Error('503');
      },
    ),
  ).toEqual({ data: empty, unavailable: false, categories: [], categoriesUnavailable: true });
});
it('does not invent personas when the list fails or both services fail', async () => {
  const fail = async (): Promise<never> => {
    throw Error('503');
  };
  expect(await loadExplore(fail, async () => ['TEST ONLY'])).toMatchObject({
    data: null,
    unavailable: true,
    categories: ['TEST ONLY'],
  });
  expect(await loadExplore(fail, fail)).toMatchObject({
    data: null,
    unavailable: true,
    categoriesUnavailable: true,
  });
});
