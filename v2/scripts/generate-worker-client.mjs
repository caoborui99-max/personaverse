import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
rmSync('cloudflare/generated/client', { recursive: true, force: true });
const source = readFileSync('database/schema.prisma', 'utf8');
writeFileSync(
  'cloudflare/schema.prisma',
  source.replace(
    'provider = "prisma-client-js"',
    'provider = "prisma-client"\n  runtime = "workerd"\n  moduleFormat = "esm"\n  engineType = "client"\n  output = "./generated/client"',
  ),
);
const p = spawnSync(
  process.execPath,
  ['node_modules/prisma/build/index.js', 'generate', '--schema', 'cloudflare/schema.prisma'],
  { stdio: 'inherit' },
);
process.exit(p.status ?? 1);
