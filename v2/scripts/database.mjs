import { spawnSync } from 'node:child_process';
const environment = process.env.APP_ENV;
const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid');
if (
  !['test', 'development'].includes(environment ?? '') ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
  !url.pathname.startsWith('/personaverse_v2_' + (environment === 'test' ? 'test' : 'dev'))
)
  throw new Error(
    'Refusing database command: explicit isolated local environment and database name required.',
  );
const action = process.argv[2];
const tasks = {
  migrate: ['migrate', 'deploy'],
  validate: ['validate'],
  generate: ['generate'],
  diff: [
    'migrate',
    'diff',
    '--from-url',
    url.toString(),
    '--to-schema-datamodel',
    'database/schema.prisma',
    '--exit-code',
  ],
};
if (!Object.hasOwn(tasks, action)) throw new Error('Unknown database command');
const args = [
  ...tasks[action],
  ...(action === 'diff' ? [] : ['--schema', 'database/schema.prisma']),
];
const p = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', ...args], {
  env: process.env,
  stdio: 'pipe',
  encoding: 'utf8',
});
const clean = (s) =>
  (s ?? '')
    .replaceAll(url.toString(), '[private database URL]')
    .replaceAll(decodeURIComponent(url.password), '[redacted]');
process.stdout.write(clean(p.stdout));
process.stderr.write(clean(p.stderr));
process.exit(p.status ?? 1);
