import { it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
type Message = { to: string; purpose: 'verify' | 'reset'; token: string };
type Mailbox = { url: string; capability: string; messages: Message[]; close: () => Promise<void> };
async function mailbox(): Promise<Mailbox> {
  const moduleUrl = new URL('../../scripts/local-mail-bridge.mjs', import.meta.url);
  const mod = (await import(moduleUrl.href)) as { localMailBridge: () => Promise<Mailbox> };
  return mod.localMailBridge();
}
it('rejects non-ASCII credentials without terminating the local bridge, then still delivers privately', async () => {
  const bridge = await mailbox();
  try {
    const rejected = await fetch(bridge.url, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + 'é'.repeat(64) },
      body: '{}',
    });
    expect(rejected.status).toBe(403);
    expect(bridge.messages).toHaveLength(0);
    const message: Message = {
      to: 'synthetic@test.invalid',
      purpose: 'verify',
      token: randomBytes(32).toString('hex'),
    };
    const accepted = await fetch(bridge.url, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + bridge.capability, 'content-type': 'application/json' },
      body: JSON.stringify(message),
    });
    expect(accepted.status).toBe(204);
    expect(await accepted.text()).toBe('');
    expect(bridge.messages).toEqual([message]);
    expect(
      (await fetch(bridge.url, { headers: { authorization: 'Bearer ' + bridge.capability } }))
        .status,
    ).toBe(403);
  } finally {
    await bridge.close();
  }
});
it('does not accept an invalid message or expose an outbox HTTP read route', async () => {
  const bridge = await mailbox();
  try {
    const result = await fetch(bridge.url, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + bridge.capability, 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'synthetic@test.invalid', purpose: 'reset', token: 'invalid' }),
    });
    expect(result.status).toBe(503);
    expect(bridge.messages).toHaveLength(0);
    expect((await fetch(bridge.url + '/outbox')).status).toBe(403);
  } finally {
    await bridge.close();
  }
});
