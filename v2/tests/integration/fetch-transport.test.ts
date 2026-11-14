import { it, expect } from 'vitest';
import { createFetchApp } from '../../apps/api/src/fetch-app.ts';
import { driverFailure } from '../../apps/api/src/driver-errors.ts';
function app() {
  const a = createFetchApp();
  a.setErrorHandler((e, req, reply) =>
    reply
      .code('statusCode' in e ? Number(e.statusCode) : 500)
      .send({ error: { requestId: req.id } }),
  );
  a.setNotFoundHandler((_, reply) => reply.code(404).send({ error: 'not found' }));
  return a;
}
it('retains status, JSON, request IDs, no-store and multiple query values', async () => {
  const a = app();
  a.addHook('onRequest', async (_, reply) => {
    reply.header('cache-control', 'no-store');
  });
  a.post('/echo/:id', async (req, reply) => {
    reply.code(201).header('Set-Cookie', 'test=1; HttpOnly; SameSite=Strict; Path=/');
    return { id: req.params, query: req.query, body: req.body, requestId: req.id };
  });
  const res = await a.fetch(
    new Request('http://local/echo/%E4%BA%BA?q=a&q=b', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"input":" ORIGINAL \\n"}',
    }),
  );
  expect(res.status).toBe(201);
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(res.headers.get('set-cookie')).toContain('SameSite=Strict');
  const body = await res.json();
  expect(body.id.id).toBe('人');
  expect(body.query.q).toEqual(['a', 'b']);
  expect(body.body.input).toBe(' ORIGINAL \n');
  expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
});
it('cannot decode static route names to bypass the admin prefix guard', async () => {
  const a = app();
  a.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/admin')) reply.code(401).send({ error: 'auth' });
  });
  a.get('/admin/private', () => ({ sensitive: true }));
  for (const path of [
    '/admin/private',
    '/%61dmin/private',
    '/admin%2Fprivate',
    '/admin%5cprivate',
  ]) {
    const r = await a.fetch(new Request('http://local' + path));
    expect([400, 401, 404]).toContain(r.status);
    expect(await r.text()).not.toContain('sensitive');
  }
});
it('guards unknown write routes before parsing a request body', async () => {
  const a = app();
  a.addHook('onRequest', async (req, reply) => {
    if (req.headers.origin !== 'http://trusted') reply.code(403).send({ error: 'origin' });
  });
  const r = await a.fetch(
    new Request('http://local/unknown', {
      method: 'POST',
      headers: { origin: 'http://evil', 'content-type': 'application/json' },
      body: '{malformed',
    }),
  );
  expect(r.status).toBe(403);
});
it('rejects malformed paths, JSON and unsupported content types', async () => {
  const a = app();
  a.post('/echo/:id', (req) => req.body);
  for (const [path, type, body, status] of [
    ['/echo/%FF', 'application/json', '{}', 400],
    ['/echo/ok', 'application/json', '{', 400],
    ['/echo/ok', 'text/plain', '{}', 415],
  ] as const) {
    expect(
      (
        await a.fetch(
          new Request('http://local' + path, {
            method: 'POST',
            headers: { 'content-type': type },
            body,
          }),
        )
      ).status,
    ).toBe(status);
  }
});
it('caps streamed bodies even without content-length', async () => {
  const a = app();
  a.post('/echo', () => ({ ok: true }));
  let cancelled = false;
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(1_500_000));
      c.enqueue(new Uint8Array(800_000));
    },
    cancel() {
      cancelled = true;
    },
  });
  const init: RequestInit & { duplex: 'half' } = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: stream,
    duplex: 'half',
  };
  expect((await a.fetch(new Request('http://local/echo', init))).status).toBe(413);
  expect(cancelled).toBe(true);
});
it('HEAD does not leak a body and unsupported registration fails closed', async () => {
  const a = app();
  a.get('/health', () => ({ ok: true }));
  expect(await (await a.fetch(new Request('http://local/health', { method: 'HEAD' }))).text()).toBe(
    '',
  );
  expect(() => a.addHook('preHandler', async () => {})).toThrow('UNSUPPORTED_HOOK');
  await expect(createFetchApp().ready()).rejects.toThrow('INCOMPLETE_REGISTRATION');
});
it.each([
  ['23514', 409, 'DATA_INTEGRITY'],
  ['55P03', 409, 'CONCURRENT_REQUEST'],
  ['40001', 409, 'CONCURRENT_REQUEST'],
  ['23505', 409, 'DUPLICATE'],
  ['23503', 400, 'INVALID_REFERENCE'],
  ['42501', 409, 'PUBLICATION_INTENT_REQUIRED'],
  ['P0001', 409, 'IMMUTABLE_RECORD'],
  ['57P01', 503, 'DATABASE_UNAVAILABLE'],
] as const)('maps SQLSTATE %s without exposing driver details', (state, status, code) => {
  const e = new Error('sensitive SQL detail');
  e.name = 'DriverAdapterError';
  Object.assign(e, { cause: { originalCode: state, originalMessage: 'sensitive SQL detail' } });
  const result = driverFailure(e);
  expect(result).toMatchObject({ status, code });
  expect(JSON.stringify(result)).not.toContain('sensitive');
});
it('maps nested no-Rust P2010 driver metadata to the same concurrency contract', () => {
  const error = Object.assign(new Error('raw query failed'), {
    name: 'PrismaClientKnownRequestError',
    code: 'P2010',
    meta: { driverAdapterError: { name: 'DriverAdapterError', cause: { originalCode: '55P03' } } },
  });
  expect(driverFailure(error)).toMatchObject({ status: 409, code: 'CONCURRENT_REQUEST' });
});
