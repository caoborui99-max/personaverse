// Reviewed source transformation of pinned hash-wasm; never patch globals or enable dynamic eval.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url),
  root = dirname(require.resolve('hash-wasm/package.json'));
const source = readFileSync(join(root, 'dist/index.esm.js'), 'utf8').replaceAll('\r\n', '\n');
const checksum = createHash('sha256').update(source).digest('hex');
if (
  JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version !== '4.13.0' ||
  checksum !== '0682e7339e5fc2107cceae8d460f02533cfcb0cc3fe65f5f622fb56158b75f7e'
)
  throw new Error('Unreviewed hash-wasm source; refusing to generate');
const folder = 'cloudflare/generated/hash-wasm';
mkdirSync(folder, { recursive: true });
for (const name of ['argon2', 'blake2b']) {
  const match = [
    ...source.matchAll(/var name([\w$]*) = "([^"]+)";\s*var data\1 = "([A-Za-z0-9+/=]+)";/g),
  ].find((m) => m[2] === name);
  if (!match) throw new Error('Expected WASM binary missing');
  const bytes = Buffer.from(match[3], 'base64');
  if (bytes.subarray(0, 4).toString('hex') !== '0061736d') throw new Error('Invalid WASM magic');
  writeFileSync(join(folder, name + '.wasm'), bytes);
  console.log(
    name +
      ': ' +
      bytes.length +
      ' bytes sha256=' +
      createHash('sha256').update(bytes).digest('hex'),
  );
}
const needle = 'const promise = WebAssembly.compile(asm.buffer);';
if (source.split(needle).length !== 2) throw new Error('Expected exactly one compilation site');
const patched =
  `import argonModule from './argon2.wasm';\nimport blakeModule from './blake2b.wasm';\nconst staticModules={argon2:argonModule,blake2b:blakeModule};\n` +
  source.replace(
    needle,
    `const staticModule=staticModules[binary.name]; if(!staticModule) throw new Error('UNAPPROVED_WASM_ALGORITHM'); const promise = Promise.resolve(staticModule);`,
  );
if (/WebAssembly\.(compile|compileStreaming)|new Function\(|\beval\(/.test(patched))
  throw new Error('Dynamic compilation remained');
writeFileSync(join(folder, 'static.mjs'), patched);
copyFileSync(join(root, 'LICENSE'), join(folder, 'LICENSE'));
console.log('Pinned static WASM adapter generated; upstream cryptographic algorithm unchanged.');
