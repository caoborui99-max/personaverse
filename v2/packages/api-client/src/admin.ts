import { z } from 'zod';
import {
  AdminPersona,
  CoreVersion,
  ErrorEnvelope,
  ChatSession,
  type DraftFields,
} from '@pv/shared';
const Session = z.object({
  admin: z.object({ id: z.string(), email: z.string(), role: z.string() }),
  csrfToken: z.string(),
});
export class AdminApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function createAdminClient(base = '/api/v1') {
  let csrf: string | undefined;
  async function request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    const res = await fetch(base + path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(csrf ? { 'x-csrf-token': csrf } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const value: unknown = await res.json();
    if (!res.ok) {
      const e = ErrorEnvelope.safeParse(value);
      throw new AdminApiError(
        res.status,
        e.success ? e.data.error.code : 'INVALID_RESPONSE',
        e.success ? e.data.error.message : '请求失败。',
      );
    }
    return value;
  }
  async function session() {
    const s = Session.parse(await request('/admin/auth/session'));
    csrf = s.csrfToken;
    return s;
  }
  async function write(path: string, body: unknown, method = 'POST') {
    await session();
    return request(path, method, body);
  }
  return {
    session,
    async login(email: string, password: string) {
      const pre = z.object({ csrfToken: z.string() }).parse(await request('/admin/auth/csrf'));
      csrf = pre.csrfToken;
      await request('/admin/auth/login', 'POST', { email, password });
      return session();
    },
    async logout() {
      await write('/admin/auth/logout', {});
      try {
        await session();
      } catch (e) {
        if (e instanceof AdminApiError && e.status === 401) {
          csrf = undefined;
          return;
        }
        throw e;
      }
      throw new Error('退出后会话仍然有效。');
    },
    async password(currentPassword: string, newPassword: string) {
      return write('/admin/auth/password', { currentPassword, newPassword });
    },
    async list(query = '') {
      return z
        .object({ items: z.array(AdminPersona), total: z.number() })
        .parse(await request('/admin/personas' + query));
    },
    async get(id: string) {
      return AdminPersona.parse(await request('/admin/personas/' + encodeURIComponent(id)));
    },
    async create() {
      return AdminPersona.parse(await write('/admin/personas', {}));
    },
    async save(id: string, fields: DraftFields, expectedRevision: number) {
      return AdminPersona.parse(
        await write('/admin/personas/' + id, { ...fields, expectedRevision }, 'PUT'),
      );
    },
    async action(
      id: string,
      action: 'publish' | 'unpublish' | 'archive',
      expectedRevision: number,
    ) {
      return AdminPersona.parse(
        await write('/admin/personas/' + id + '/' + action, { expectedRevision }),
      );
    },
    async categories() {
      return z
        .object({
          items: z.array(z.object({ id: z.string(), name: z.string(), slug: z.string() })),
        })
        .parse(await request('/admin/categories'));
    },
    async category(name: string, slug: string) {
      return write('/admin/categories', { name, slug });
    },
    async versions(id: string) {
      return z
        .object({ items: z.array(CoreVersion) })
        .parse(await request('/admin/personas/' + id + '/versions'));
    },
    async restore(id: string, versionId: string, expectedRevision: number) {
      return AdminPersona.parse(
        await write('/admin/personas/' + id + '/restore', { versionId, expectedRevision }),
      );
    },
    async compare(id: string, from: string, to: string) {
      return z
        .object({ from: CoreVersion, to: CoreVersion, changedFields: z.array(z.string()) })
        .parse(await request(`/admin/personas/${id}/compare?from=${from}&to=${to}`));
    },
    async test(personaId: string, versionId: string) {
      return z
        .object({ id: z.string(), coreVersionId: z.string(), mode: z.literal('mock') })
        .parse(await write('/admin/test/sessions', { personaId, versionId }));
    },
    async testSend(id: string, clientMessageId: string, content: string) {
      await session();
      return ChatSession.parse(
        await request(`/admin/test/sessions/${id}/messages`, 'POST', { clientMessageId, content }),
      );
    },
  };
}
