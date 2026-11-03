import { mkdir, readFile, readdir, cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = process.cwd();
// Fail visibly instead of publishing a test site with a nonfunctional admin API.
if (process.env.VERCEL) {
  const missing = ['DATABASE_URL', 'ADMIN_EMAIL', 'ADMIN_PASSWORD'].filter(key => !process.env[key]);
  if (missing.length) throw new Error('Vercel server environment missing: ' + missing.join(', '));
  if (process.env.ADMIN_PASSWORD.length < 12) throw new Error('ADMIN_PASSWORD must contain at least 12 characters.');
}
const files = ['index.html', 'persona.html', 'admin.html', '.nojekyll'];
async function check(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await check(file);
    else if (entry.name.endsWith('.js')) {
      const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr);
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

// Vercel executes this server-side. A phone-only owner can connect Neon and redeploy
// without running SQL or a terminal. Existing seed data is never overwritten.
if (process.env.DATABASE_URL) {
  const { getDatabase, migrateDatabase, closeDatabases } = await import('../server/database.js');
  const { initializeData } = await import('../server/handler.js');
  try {
    const db = await getDatabase(process.env);
    await migrateDatabase(db);
    await initializeData(db);
    console.log('Persistent database migration/one-time seed completed.');
  } finally { await closeDatabases(); }
} else {
  console.log('DATABASE_URL is not configured; server APIs will require database setup.');
}

