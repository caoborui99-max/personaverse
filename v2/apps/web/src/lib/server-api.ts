import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Persona, PersonaList } from '@pv/shared';
import { z } from 'zod';
const base = () => (process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4311') + '/api/v1';
async function apiFetch(url: string, options: RequestInit) {
  if (process.env.PV_WORKERS_ADAPTER === 'opennext') {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const env = getCloudflareContext().env as unknown as {
      API: { fetch: (r: Request) => Promise<Response> };
      MOCK_PREVIEW?: string;
      WEB_ORIGIN: string;
      BRIDGE_SECRET: string;
    };
    if (env.MOCK_PREVIEW === 'closed') {
      const { signBridge } = await import('../../../../packages/api-client/src/private-bridge.ts');
      const target = new URL(url);
      const origin = new URL(env.WEB_ORIGIN);
      target.protocol = origin.protocol;
      target.host = origin.host;
      return env.API.fetch(
        await signBridge(new Request(target, options), env.BRIDGE_SECRET, 'ssr'),
      );
    }
    return env.API.fetch(new Request(url, options));
  }
  return fetch(url, options);
}
export async function publicList(query = '') {
  const res = await apiFetch(base() + '/personas' + query, {
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error('公开目录服务不可用。');
  return PersonaList.parse(await res.json());
}
export async function publicPersona(slug: string) {
  const res = await apiFetch(base() + '/personas/' + encodeURIComponent(slug), {
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('公开目录服务不可用。');
  return Persona.parse((await res.json()).persona);
}
export async function mockMode() {
  const res = await apiFetch(base() + '/health', {
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error('API 不可用。');
  return (await res.json()).mode === 'mock';
}
export async function requireAdminPage() {
  const jar = await cookies();
  const res = await apiFetch(base() + '/admin/auth/session', {
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
  const res = await apiFetch(base() + '/categories', {
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error('分类服务不可用。');
  return z.object({ items: z.array(z.string()) }).parse(await res.json()).items;
}

export async function requireUserPage(next = '/account') {
  const jar = await cookies();
  const res = await apiFetch(base() + '/auth/session', {
    headers: { cookie: jar.toString() },
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  if (res.status === 401) redirect('/login?next=' + encodeURIComponent(next));
  if (!res.ok) throw new Error('个人账户服务暂时不可用。');
  return z
    .object({
      user: z.object({
        id: z.string(),
        email: z.string(),
        displayName: z.string(),
        emailVerifiedAt: z.string().nullable(),
      }),
    })
    .parse(await res.json()).user;
}

// Do not require Strict session cookies on the first cross-site callback GET.
// This checks availability only; authenticated binding remains a same-origin CSRF POST.
export async function rengineCallbackEnabled() {
  try {
    const res = await apiFetch(base() + '/auth/rengine/capabilities', {
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return false;
    return z.object({ enabled: z.boolean() }).parse(await res.json()).enabled;
  } catch {
    return false;
  }
}
