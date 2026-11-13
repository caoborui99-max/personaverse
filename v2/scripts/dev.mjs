import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const child = spawn('pnpm', ['--parallel', '--filter', '@pv/web', '--filter', '@pv/api', 'dev'], {
  env: process.env,
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 1));
