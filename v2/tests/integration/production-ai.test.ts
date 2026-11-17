import { it, expect } from 'vitest';
import { DeepSeekProvider } from '../../apps/api/src/ai/deepseek.ts';
import { productionOrigin, productionDatabase } from '../../cloudflare/production/policy.ts';
it('uses fixed HTTPS server transport, bounded output, no redirects and no automatic retries', async () => {
  let calls = 0;
  const provider = new DeepSeekProvider('synthetic-test-key', async (url, init) => {
    calls++;
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(init?.redirect).toBe('error');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'deepseek-chat',
      stream: false,
      max_tokens: 1024,
    });
    return Response.json({
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'TEST ONLY' } }],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    });
  });
  expect(await provider.complete([{ role: 'user', content: 'TEST ONLY' }])).toEqual({
    content: 'TEST ONLY',
    inputTokens: 10,
    outputTokens: 2,
  });
  expect(calls).toBe(1);
});
it.each(['network', '429', 'json', 'length', 'oversize'])(
  'fails closed on %s without retry or upstream data exposure',
  async (mode) => {
    let calls = 0;
    const provider = new DeepSeekProvider('synthetic-test-key', async () => {
      calls++;
      if (mode === 'network') throw new Error('synthetic transport failure');
      if (mode === '429') return new Response('limited', { status: 429 });
      if (mode === 'oversize')
        return new Response('x'.repeat(131073), {
          headers: { 'content-type': 'application/json' },
        });
      if (mode === 'json') return Response.json({});
      return Response.json({
        choices: [{ finish_reason: 'length', message: { role: 'assistant', content: 'partial' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1024 },
      });
    });
    await expect(provider.complete([])).rejects.toThrow();
    expect(calls).toBe(1);
  },
);
it('rejects unconfigured production targets', () => {
  expect(() => productionOrigin('https://REPLACE.example')).toThrow();
  expect(() => productionOrigin('http://example.com')).toThrow();
  expect(productionOrigin('https://example.com')).toBe('https://example.com');
  expect(() =>
    productionDatabase('postgresql://wrong:password@localhost/wrong', 'target', 'app'),
  ).toThrow();
});

import { productionMail } from '../../cloudflare/production/mail.ts';
import { gateway } from '../../cloudflare/production/gateway.ts';
it('keeps production registration pages available and refuses external identity routes and forged forwarding headers', async () => {
  const env = {
    WEB_ORIGIN: 'https://example.com',
    BRIDGE_SECRET: 'x'.repeat(64),
    API: {
      async fetch() {
        return new Response('private');
      },
    },
  };
  expect(
    (
      await gateway(
        new Request('https://example.com/register'),
        env,
        async () => new Response('register'),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await gateway(
        new Request('https://example.com/api/v1/auth/rengine/start'),
        env,
        async () => new Response('bad'),
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await gateway(
        new Request('https://example.com/', { headers: { 'x-pv-ip': 'fake' } }),
        env,
        async () => new Response('bad'),
      )
    ).status,
  ).toBe(403);
});
it('sends only server-side email links and rejects failed delivery', async () => {
  const mail = productionMail(
    {
      WEB_ORIGIN: 'https://example.com',
      RESEND_API_KEY: 'synthetic-only',
      MAIL_FROM: 'test@example.com',
    },
    async (url, init) => {
      expect(url).toBe('https://api.resend.com/emails');
      expect(JSON.parse(String(init?.body)).text).toContain(
        'https://example.com/verify-email#token=synthetic-only',
      );
      return new Response('', { status: 503 });
    },
  );
  await expect(
    mail.send({ to: 'test@test.invalid', purpose: 'verify', token: 'synthetic-only' }),
  ).rejects.toThrow('MAIL_DELIVERY_FAILED');
});
