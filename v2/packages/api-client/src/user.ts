import { z } from 'zod';
import { ChatSession, ErrorEnvelope, Persona } from '@pv/shared';
export const UserProfile = z.object({
  id: z.string().uuid(),
  email: z.string(),
  displayName: z.string(),
  emailVerifiedAt: z.string().nullable(),
});
export type UserProfile = z.infer<typeof UserProfile>;
const UserSession = z.object({ user: UserProfile, csrfToken: z.string() });
export const PersonalConversation = ChatSession.extend({
  personaName: z.string().optional(),
  canSend: z.boolean().optional(),
  pagination: z
    .object({ hasMore: z.boolean(), nextBefore: z.number().int().nullable() })
    .optional(),
});
export type PersonalConversation = z.infer<typeof PersonalConversation>;
const HistoryList = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      personaSlug: z.string(),
      personaName: z.string(),
      status: z.string(),
      createdAt: z.string(),
      updatedAt: z.string(),
    }),
  ),
  page: z.number(),
  limit: z.number(),
  total: z.number(),
});
export type PersonalHistoryList = z.infer<typeof HistoryList>;
export class UserApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function createUserClient(base = '/api/v1') {
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
    let value: unknown;
    try {
      value = await res.json();
    } catch {
      throw new UserApiError(res.status, 'INVALID_RESPONSE', '服务暂时不可用，请稍后重试。');
    }
    if (!res.ok) {
      const parsed = ErrorEnvelope.safeParse(value);
      throw new UserApiError(
        res.status,
        parsed.success ? parsed.data.error.code : 'INVALID_RESPONSE',
        parsed.success ? parsed.data.error.message : '请求失败，请稍后重试。',
      );
    }
    return value;
  }
  async function session() {
    const s = UserSession.parse(await request('/auth/session'));
    csrf = s.csrfToken;
    return s;
  }
  async function anonymous(path: string, body: unknown) {
    csrf = z.object({ csrfToken: z.string() }).parse(await request('/auth/csrf')).csrfToken;
    return request(path, 'POST', body);
  }
  async function write(path: string, body: unknown, method = 'POST') {
    await session();
    return request(path, method, body);
  }
  return {
    session,
    register: (email: string, password: string, displayName: string) =>
      anonymous('/auth/register', { email, password, displayName }),
    verify: (token: string) => anonymous('/auth/verify', { token }),
    forgot: (email: string) => anonymous('/auth/forgot-password', { email }),
    reset: (token: string, newPassword: string) =>
      anonymous('/auth/reset-password', { token, newPassword }),
    resend: (email: string) => anonymous('/auth/resend-verification', { email }),
    async login(email: string, password: string) {
      await anonymous('/auth/login', { email, password });
      return session();
    },
    async logout() {
      await write('/auth/logout', {});
      try {
        await session();
      } catch (e) {
        if (e instanceof UserApiError && e.status === 401) {
          csrf = undefined;
          return;
        }
        throw e;
      }
      throw new Error('退出后的会话状态未确认，请重试。');
    },
    profile: (displayName: string) => write('/me', { displayName }, 'PUT'),
    async removeAccount(password: string) {
      await write('/me', { password }, 'DELETE');
      csrf = undefined;
    },
    async historyList(page = 1) {
      return HistoryList.parse(await request('/me/chats?page=' + page + '&limit=20'));
    },
    async history(id: string, before?: number) {
      return PersonalConversation.parse(
        await request(
          '/me/chats/' +
            encodeURIComponent(id) +
            (before === undefined ? '' : '?before=' + before + '&limit=100'),
        ),
      );
    },
    async createSession(personaSlug: string, clientRequestId: string) {
      return PersonalConversation.parse(await write('/me/chats', { personaSlug, clientRequestId }));
    },
    async send(id: string, clientMessageId: string, content: string) {
      return PersonalConversation.parse(
        await write('/me/chats/' + encodeURIComponent(id) + '/messages', {
          clientMessageId,
          content,
        }),
      );
    },
    async removeChat(id: string) {
      return write('/me/chats/' + encodeURIComponent(id), {}, 'DELETE');
    },
    async favorites(page = 1) {
      return z
        .object({ items: z.array(Persona), page: z.number(), limit: z.number(), total: z.number() })
        .parse(await request('/me/favorites?page=' + page + '&limit=20'));
    },
    async favorite(slug: string) {
      return z
        .object({ saved: z.boolean() })
        .parse(await request('/me/favorites/' + encodeURIComponent(slug)));
    },
    async setFavorite(slug: string, saved: boolean) {
      return write('/me/favorites/' + encodeURIComponent(slug), {}, saved ? 'PUT' : 'DELETE');
    },
  };
}
