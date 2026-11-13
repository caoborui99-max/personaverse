import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Persona, PersonaList } from '@pv/shared';
import { z } from 'zod';
const base = () => (process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4311') + '/api/v1';
export async function publicList(query = '') {
  const res = await fetch(base() + '/personas' + query, {
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error('公开目录服务不可用。');
  return PersonaList.parse(await res.json());
}
export async function publicPersona(slug: string) {
  const res = await fetch(base() + '/personas/' + encodeURIComponent(slug), {
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('公开目录服务不可用。');
  return Persona.parse((await res.json()).persona);
}
export async function mockMode() {
  const res = await fetch(base() + '/health', {
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error('API 不可用。');
  return (await res.json()).mode === 'mock';
}
export async function requireAdminPage() {
  const jar = await cookies();
  const res = await fetch(base() + '/admin/auth/session', {
    headers: { cookie: jar.toString() },
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  if (res.status === 401) redirect('/admin/login');
  if (!res.ok) throw new Error('管理员会话服务暂时不可用。');
  return z
    .object({ admin: z.object({ id: z.string(), email: z.string(), role: z.string() }) })
    .parse(await res.json()).admin;
}

export async function publicCategories() {
  const res = await fetch(base() + '/categories', {
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error('分类服务不可用。');
  return z.object({ items: z.array(z.string()) }).parse(await res.json()).items;
}
