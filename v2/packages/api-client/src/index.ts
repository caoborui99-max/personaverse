import { ChatSession, ErrorEnvelope, PersonaList } from '@pv/shared';
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public retryable: boolean,
  ) {
    super(message);
  }
}
export function createClient(base = '/api/v1') {
  async function request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    const response = await fetch(base + path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    });
    const data: unknown = await response.json();
    if (!response.ok) {
      const parsed = ErrorEnvelope.safeParse(data);
      throw new ApiError(
        parsed.success ? parsed.data.error.code : 'INVALID_RESPONSE',
        parsed.success ? parsed.data.error.message : '服务暂时不可用',
        response.status,
        parsed.success && parsed.data.error.retryable,
      );
    }
    return data;
  }
  return {
    async personas(query = '') {
      return PersonaList.parse(await request('/personas' + query));
    },
    async visitor() {
      return request('/visitor/session', 'POST', {});
    },
    async createSession(personaSlug: string) {
      return ChatSession.parse(await request('/chat/sessions', 'POST', { personaSlug }));
    },
    async history(id: string) {
      return ChatSession.parse(
        await request('/chat/sessions/' + encodeURIComponent(id) + '/messages'),
      );
    },
    async send(id: string, clientMessageId: string, content: string) {
      return ChatSession.parse(
        await request('/chat/sessions/' + encodeURIComponent(id) + '/messages', 'POST', {
          clientMessageId,
          content,
        }),
      );
    },
    async clear() {
      return request('/chat/sessions', 'DELETE');
    },
  };
}
