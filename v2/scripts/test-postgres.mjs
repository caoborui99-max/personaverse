import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFileSync, existsSync, unlinkSync } from 'node:fs';
const name = 'personaverse-v2-isolated-test';
const env = { ...process.env };
for (const key of [
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_TLS',
  'DOCKER_TLS_VERIFY',
  'DOCKER_CERT_PATH',
])
  delete env[key];
function docker(args) {
  const p = spawnSync('docker', ['--host=unix:///var/run/docker.sock', ...args], {
    env,
    encoding: 'utf8',
  });
  if (p.status !== 0) throw new Error('Local Docker operation failed: ' + p.stderr);
  return p.stdout.trim();
}
if (process.argv[2] === 'stop') {
  const label = docker([
    'inspect',
    '--format',
    '{{index .Config.Labels "personaverse.isolated-test"}}',
    name,
  ]);
  if (label !== 'true') throw new Error('Refusing to remove an unowned container');
  docker(['rm', '-f', name]);
  if (existsSync('.env.test.local')) unlinkSync('.env.test.local');
  console.log('Isolated PostgreSQL test container removed');
} else {
  if (existsSync('.env.test.local'))
    throw new Error('Test configuration already exists; do not overwrite');
  const password = randomBytes(32).toString('hex');
  const file = '.env.postgres.local';
  writeFileSync(
    file,
    `POSTGRES_USER=pv_test\nPOSTGRES_PASSWORD=${password}\nPOSTGRES_DB=personaverse_v2_test\n`,
    { mode: 0o600 },
  );
  try {
    docker([
      'run',
      '-d',
      '--name',
      name,
      '--label',
      'personaverse.isolated-test=true',
      '--env-file',
      file,
      '--publish',
      '127.0.0.1::5432',
      '--tmpfs',
      '/var/lib/postgresql/data',
      'postgres:16-bookworm@sha256:a49f7438ba03589f9b1ca062f2da82e899b48ea1dc50d2449fa09a70be83ebca',
    ]);
  } finally {
    unlinkSync(file);
  }
  const port = docker(['port', name, '5432/tcp']).split(':').at(-1);
  writeFileSync(
    '.env.test.local',
    `APP_ENV=test\nPV_MODE=database\nDATABASE_URL=postgresql://pv_test:${password}@127.0.0.1:${port}/personaverse_v2_test\n`,
    { mode: 0o600 },
  );
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      docker(['exec', name, 'pg_isready', '-U', 'pv_test', '-d', 'personaverse_v2_test']);
      console.log(
        `Isolated PostgreSQL ready on loopback port ${port}; private configuration written to .env.test.local`,
      );
      process.exit(0);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error('Isolated PostgreSQL did not become ready');
}
