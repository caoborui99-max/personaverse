import { it, expect } from 'vitest';
import { hash as nativeHash, verify as nativeVerify, Algorithm } from '@node-rs/argon2';
import { hash, verify } from '../../cloudflare/argon-wasm.ts';
const parameters = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};
it.each(['synthetic password', ' Unicode 人格 🔒 ', 'x'.repeat(256)])(
  'PHC Node/WASM interoperability: %s',
  async (password) => {
    const node = await nativeHash(password, parameters);
    expect(await verify(node, password)).toBe(true);
    const wasm = await hash(password);
    expect(await nativeVerify(wasm, password)).toBe(true);
    expect(await verify(wasm, password + 'wrong')).toBe(false);
  },
);
it('rejects malformed or excessive PHC parameters before memory allocation', async () => {
  for (const value of [
    '',
    '$argon2id$v=19$m=999999999,t=2,p=1$abc$def',
    '$argon2i$v=19$m=19456,t=2,p=1$abc$def',
  ])
    expect(await verify(value, 'synthetic')).toBe(false);
  await expect(hash('x'.repeat(257))).rejects.toThrow('ARGON_PARAMETERS');
});
it('uses random salt and bounds simultaneous memory-hard operations', async () => {
  const results = await Promise.allSettled([hash('test'), hash('test'), hash('test')]);
  expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(2);
  expect(results.filter((x) => x.status === 'rejected')).toHaveLength(1);
  const values = results.filter((x) => x.status === 'fulfilled').map((x) => x.value);
  expect(values[0]).not.toBe(values[1]);
});
