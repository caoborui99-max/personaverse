import { mkdir, readFile, readdir, cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import './check-personas.mjs';
function checkSyntax(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--check', file], { stdio: 'inherit', timeout: 30000 });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error('Syntax check failed: ' + file + ' (' + (signal || code) + ')')));
  });
}
const root = process.cwd();
// Fail visibly instead of publishing a test site with a nonfunctional admin API.
if (process.env.VERCEL) {
  const missing = ['DATABASE_URL', 'ADMIN_EMAIL', 'ADMIN_PASSWORD'].filter(key => !process.env[key]);
  if (missing.length) throw new Error('Vercel server environment missing: ' + missing.join(', '));
  if (process.env.ADMIN_PASSWORD.length < 12) throw new Error('ADMIN_PASSWORD must contain at least 12 characters.');
}
const files = ['index.html', 'persona.html', 'admin.html', 'chat.html', '.nojekyll'];
async function check(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await check(file);
    else if (entry.name.endsWith('.js')) {
      await checkSyntax(file);
    }
  }
}
for (const dir of ['server', 'api', 'js', 'scripts']) await check(path.join(root, dir));
for (const file of files) await readFile(path.join(root, file));
const output = path.join(root, 'public');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of files) await cp(path.join(root, file), path.join(output, file));
for (const dir of ['css', 'js', 'assets']) await cp(path.join(root, dir), path.join(output, dir), { recursive: true });
console.log('Build complete: frontend only in public/. API source and environment values are excluded.');

// Schema changes are an explicit operator action, never a build side effect.
console.log('Database migration skipped by design. Run npm run db:migrate explicitly in the intended environment.');
