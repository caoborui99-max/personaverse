import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../apps/api/src/app';
import { ChatSession, ErrorEnvelope, PersonaList } from '@pv/shared';
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
async function fixture() {
  const app = buildApp();
  apps.push(app);
  await app.ready();
  const origin = 'http://127.0.0.1:4310';
  const visitor = await app.inject({
    method: 'POST',
    url: '/api/v1/visitor/session',
    headers: { origin },
    payload: {},
  });
  const cookie = String(visitor.headers['set-cookie']).split(';')[0]!;
  const headers = { origin, cookie };
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/chat/sessions',
    headers,
    payload: { personaSlug: 'test-a' },
  });
  return { app, headers, session: ChatSession.parse(response.json()) };
}
describe('mock API boundary', () => {
  it('serves public health, SSR data contract and category without login', async () => {
    const app = buildApp();
    apps.push(app);
    expect((await app.inject('/api/v1/health')).json()).toMatchObject({
      status: 'ok',
      mode: 'mock',
      database: 'not-connected',
    });
    expect(PersonaList.parse((await app.inject('/api/v1/personas')).json()).total).toBe(2);
    expect((await app.inject('/api/v1/categories')).statusCode).toBe(200);
    expect((await app.inject('/api/v1/personas/test-a')).json().persona).not.toHaveProperty(
      'coreText',
    );
  });
  it('validates search and pagination', async () => {
    const { app } = await fixture();
    expect((await app.inject('/api/v1/personas?q=A&limit=1')).json().items).toHaveLength(1);
    expect((await app.inject('/api/v1/personas?limit=1000')).statusCode).toBe(400);
    expect((await app.inject('/api/v1/personas/missing')).statusCode).toBe(404);
  });
  it('denies every admin path and forged role, login remains explicitly unimplemented', async () => {
    const { app, headers } = await fixture();
    for (const url of [
      '/api/v1/admin',
      '/api/v1/admin/personas',
      '/api/v1/admin/unknown',
      '/api/v1/admin/auth/session',
      '/api/v1/admin/auth/logout',
    ]) {
      const response = await app.inject({
        url,
        headers: {
          ...headers,
          authorization: 'Bearer admin',
          'x-admin': 'true',
          cookie: headers.cookie + '; admin=true',
        },
      });
      expect(response.statusCode).toBe(401);
      expect(ErrorEnvelope.parse(response.json()).error.code).toBe('ADMIN_REQUIRED');
    }
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/login',
      headers,
      payload: { email: 'test@example.invalid', password: 'fake' },
    });
    expect(login.statusCode).toBe(503);
    expect(login.json().error.code).toBe('AUTH_NOT_IMPLEMENTED');
    expect(login.headers['set-cookie']).toBeUndefined();
  });
  it('rejects cross-origin writes and invalid chat payloads', async () => {
    const { app, headers, session } = await fixture();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/visitor/session',
          headers: { origin: 'https://evil.invalid' },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: 'POST', url: '/api/v1/visitor/session', payload: {} }))
        .statusCode,
    ).toBe(403);
    for (const payload of [
      { content: '' },
      { content: 'hi', clientMessageId: randomUUID(), role: 'admin' },
    ])
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/v1/chat/sessions/${session.id}/messages`,
            headers,
            payload,
          })
        ).statusCode,
      ).toBe(400);
  });
  it('supports 20 consecutive rounds with stable session and input history', async () => {
    const { app, headers, session } = await fixture();
    for (let i = 1; i <= 20; i++) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/chat/sessions/${session.id}/messages`,
        headers,
        payload: { clientMessageId: randomUUID(), content: `消息 ${i}` },
      });
      expect(response.statusCode).toBe(200);
      const chat = ChatSession.parse(response.json());
      expect(chat.id).toBe(session.id);
      expect(chat.messages).toHaveLength(i * 2);
    }
    expect(
      (await app.inject({ url: `/api/v1/chat/sessions/${session.id}/messages`, headers })).json()
        .messages,
    ).toHaveLength(40);
  });
  it('deduplicates concurrent retry and rejects changed content under the same id', async () => {
    const { app, headers, session } = await fixture();
    const payload = { clientMessageId: randomUUID(), content: 'hello' };
    const send = (p = payload) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/chat/sessions/${session.id}/messages`,
        headers,
        payload: p,
      });
    const responses = await Promise.all([send(), send(), send()]);
    for (const res of responses) {
      expect(res.statusCode).toBe(200);
      expect(res.json().messages).toHaveLength(2);
    }
    expect((await send({ ...payload, content: 'changed' })).statusCode).toBe(409);
  });
  it('recovers from transient failure with same request id and continues sending', async () => {
    const { app, headers, session } = await fixture();
    const payload = { clientMessageId: randomUUID(), content: '/fail-once' };
    const send = (p = payload) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/chat/sessions/${session.id}/messages`,
        headers,
        payload: p,
      });
    const failure = await send();
    expect(failure.statusCode).toBe(503);
    expect(failure.json().error.retryable).toBe(true);
    expect((await send()).json().messages).toHaveLength(2);
    expect(
      (await send({ clientMessageId: randomUUID(), content: 'next' })).json().messages,
    ).toHaveLength(4);
  });
  it('isolates visitors, personas and clears all owned histories', async () => {
    const { app, headers, session } = await fixture();
    const stranger = await app.inject({
      method: 'POST',
      url: '/api/v1/visitor/session',
      headers: { origin: headers.origin },
      payload: {},
    });
    const other = {
      origin: headers.origin,
      cookie: String(stranger.headers['set-cookie']).split(';')[0]!,
    };
    expect(
      (await app.inject({ url: `/api/v1/chat/sessions/${session.id}/messages`, headers: other }))
        .statusCode,
    ).toBe(404);
    const b = await app.inject({
      method: 'POST',
      url: '/api/v1/chat/sessions',
      headers,
      payload: { personaSlug: 'test-b' },
    });
    expect(b.json().id).not.toBe(session.id);
    expect(b.json().personaSlug).toBe('test-b');
    expect(
      (await app.inject({ method: 'DELETE', url: '/api/v1/chat/sessions', headers })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: `/api/v1/chat/sessions/${session.id}/messages`, headers }))
        .statusCode,
    ).toBe(404);
  });
  it('expires anonymous cookies and sets secure attributes for HTTPS', async () => {
    let now = 100;
    const app = buildApp({ origin: 'https://example.invalid', clock: () => now });
    apps.push(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/visitor/session',
      headers: { origin: 'https://example.invalid' },
      payload: {},
    });
    expect(res.headers['set-cookie']).toContain(
      'HttpOnly; SameSite=Strict; Path=/; Max-Age=86400; Secure',
    );
    now += 86_400_001;
    expect(
      (
        await app.inject({
          url: '/api/v1/chat/sessions/00000000-0000-4000-8000-000000000001/messages',
          headers: { cookie: String(res.headers['set-cookie']).split(';')[0]! },
        })
      ).statusCode,
    ).toBe(401);
  });
  it('enforces mock request frequency without breaking 20-round acceptance', async () => {
    const { app, headers, session } = await fixture();
    for (let i = 0; i < 120; i++)
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/v1/chat/sessions/${session.id}/messages`,
            headers,
            payload: { clientMessageId: randomUUID(), content: 'test' },
          })
        ).statusCode,
      ).toBe(200);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/chat/sessions/${session.id}/messages`,
      headers,
      payload: { clientMessageId: randomUUID(), content: 'limit' },
    });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('60');
  });
});
