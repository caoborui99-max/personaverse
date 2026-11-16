import { afterEach, expect, it, vi } from 'vitest';
import {
  hash,
  verify,
  withPasswordHasher,
  type PasswordNamespace,
} from '../../cloudflare/argon-rpc.ts';
import { PARAMETERS } from '../../cloudflare/argon-policy.ts';
const encoded = '$argon2id$v=19$m=19456,t=2,p=1$' + 'A'.repeat(22) + '$' + 'A'.repeat(43);
const binding = (
  override: Partial<ReturnType<PasswordNamespace['getByName']>> = {},
): PasswordNamespace => ({
  getByName: () => ({
    hash: async () => ({ status: 'ok', value: encoded }),
    verify: async () => ({ status: 'ok', value: true }),
    ...override,
  }),
});
afterEach(() => vi.useRealTimers());
it('returns only policy-valid PHC and boolean results through the private binding', async () => {
  await withPasswordHasher(binding(), async () => {
    expect(await hash('TEST ONLY', PARAMETERS)).toBe(encoded);
    expect(await verify(encoded, 'TEST ONLY')).toBe(true);
  });
});
it('missing binding fails closed without an inline hashing fallback', async () => {
  await expect(hash('TEST ONLY')).rejects.toMatchObject({
    status: 503,
    code: 'PASSWORD_SERVICE_UNAVAILABLE',
  });
});
it('malformed PHC is rejected before invoking the private service', async () => {
  const call = vi.fn();
  expect(
    await withPasswordHasher(binding({ verify: call }), () =>
      verify('$argon2id$m=999999999$', 'TEST ONLY'),
    ),
  ).toBe(false);
  expect(call).not.toHaveBeenCalled();
});
it('rejects weakened parameters and overlong passwords without invoking the service', async () => {
  const call = vi.fn();
  await withPasswordHasher(binding({ hash: call }), async () => {
    await expect(
      hash('TEST ONLY', { ...PARAMETERS, memoryCost: 8 } as never),
    ).rejects.toMatchObject({ status: 503 });
    await expect(hash('X'.repeat(257))).rejects.toMatchObject({ status: 503 });
  });
  expect(call).not.toHaveBeenCalled();
});
it('untrusted PHC or verification result shapes are never accepted', async () => {
  await expect(
    withPasswordHasher(binding({ hash: async () => ({ status: 'ok', value: 'fast-hash' }) }), () =>
      hash('TEST ONLY'),
    ),
  ).rejects.toMatchObject({ status: 503 });
  await expect(
    withPasswordHasher(binding({ verify: async () => ({ status: 'ok', value: 'true' }) }), () =>
      verify(encoded, 'TEST ONLY'),
    ),
  ).rejects.toMatchObject({ status: 503 });
});
it('unavailability and exceptions are redacted, fail closed and never retried', async () => {
  const call = vi.fn(async () => {
    throw new Error('TEST ONLY PRIVATE PASSWORD BODY');
  });
  const error = await withPasswordHasher(binding({ verify: call }), () =>
    verify(encoded, 'TEST ONLY'),
  ).catch((e) => e);
  expect(error).toMatchObject({ status: 503, code: 'PASSWORD_SERVICE_UNAVAILABLE' });
  expect(String(error)).not.toContain('PRIVATE PASSWORD BODY');
  expect(call).toHaveBeenCalledTimes(1);
});
it('busy replies remain 429 and unknown replies remain 503', async () => {
  await expect(
    withPasswordHasher(binding({ hash: async () => ({ status: 'busy' }) }), () =>
      hash('TEST ONLY'),
    ),
  ).rejects.toMatchObject({ statusCode: 429 });
  await expect(
    withPasswordHasher(binding({ hash: async () => ({ status: 'unavailable' }) }), () =>
      hash('TEST ONLY'),
    ),
  ).rejects.toMatchObject({ status: 503 });
});
it('a timed-out call fails closed and clears its timer without retry', async () => {
  vi.useFakeTimers();
  const call = vi.fn(() => new Promise<never>(() => {}));
  const result = withPasswordHasher(binding({ hash: call }), () => hash('TEST ONLY')).catch(
    (e) => e,
  );
  await vi.advanceTimersByTimeAsync(5000);
  expect(await result).toMatchObject({ status: 503 });
  expect(call).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it('concurrent asynchronous requests keep their own binding and clean up request context', async () => {
  const a = binding({
    verify: async () => {
      await Promise.resolve();
      return { status: 'ok', value: true };
    },
  });
  const b = binding({
    verify: async () => {
      await Promise.resolve();
      return { status: 'ok', value: false };
    },
  });
  expect(
    await Promise.all([
      withPasswordHasher(a, () => verify(encoded, 'TEST ONLY')),
      withPasswordHasher(b, () => verify(encoded, 'TEST ONLY')),
    ]),
  ).toEqual([true, false]);
  await expect(verify(encoded, 'TEST ONLY')).rejects.toMatchObject({ status: 503 });
});
