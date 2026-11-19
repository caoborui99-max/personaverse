import type { PersonaList } from '@pv/shared';
import type { z } from 'zod';
export type Catalog = z.infer<typeof PersonaList>;
// A failure is kept separate from an empty, successfully loaded catalogue. No fake personas.
export async function loadCatalog(list: () => Promise<Catalog>) {
  try {
    return { data: await list(), unavailable: false as const };
  } catch {
    return { data: null, unavailable: true as const };
  }
}
export async function loadExplore(
  list: () => Promise<Catalog>,
  categories: () => Promise<string[]>,
) {
  const [catalog, filters] = await Promise.all([
    loadCatalog(list),
    categories()
      .then((items) => ({ items, unavailable: false }))
      .catch(() => ({ items: [], unavailable: true })),
  ]);
  return { ...catalog, categories: filters.items, categoriesUnavailable: filters.unavailable };
}
