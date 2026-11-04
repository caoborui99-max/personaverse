import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
// File-backed capture avoids sandbox pipe restrictions without skipping assertions.
async function execute(file, args, options) {
  const dir = await mkdtemp(join(tmpdir(), 'pv-command-'));
  const log = join(dir, 'output.log'); const fd = openSync(log, 'w');
  try {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(file, args, {...options, stdio:['ignore',fd,fd]});
      child.once('error', reject);
      child.once('exit', (code, signal) => signal ? reject(new Error('Command terminated: '+signal)) : resolve(code));
    });
    const stdout = await readFile(log, 'utf8');
    if (code !== 0) throw Object.assign(new Error('Command failed'), {code,stderr:stdout});
    return {stdout};
  } finally { closeSync(fd); await rm(dir,{recursive:true,force:true}); }
}
import { getDatabase, migrateDatabase, closeDatabases } from '../server/database.js';
import { initializeData, handleApi } from '../server/handler.js';

test('public list and detail omit internal metadata, with explicit copy opt-in', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pv-integration-'));
  const env = { SQLITE_PATH:join(dir,'test.sqlite'), ADMIN_EMAIL:'owner@example.test', ADMIN_PASSWORD:randomBytes(24).toString('hex') };
  try {
    const db = await getDatabase(env); await migrateDatabase(db); await initializeData(db);
    const row = await db.prepare('SELECT data FROM personas WHERE id=?').bind('moonlight').first();
    const p = {...JSON.parse(row.data), copyEnabled:false, systemPrompt:'private fixture prompt',
      background:'private background', creator:'internal owner', moderationNotes:{reason:'private'}, futureSecret:'fixture-internal'};
    await db.prepare('UPDATE personas SET data=? WHERE id=?').bind(JSON.stringify(p),'moonlight').run();
    for (const path of ['personas','personas/moonlight']) {
      const response = await handleApi(new Request('https://example.test/api/'+path),env);
      assert.equal(response.status,200);
      const data = await response.json(); const publicP = data.persona || data.personas.find(p=>p.id==='moonlight');
      assert.equal(publicP.name,p.name);
      for (const field of ['systemPrompt','prompt','background','creator','moderationNotes','futureSecret']) assert.equal(Object.hasOwn(publicP,field),false,field);
    }
    p.copyEnabled=true;
    await db.prepare('UPDATE personas SET data=? WHERE id=?').bind(JSON.stringify(p),'moonlight').run();
    const exposed = await handleApi(new Request('https://example.test/api/personas/moonlight'),env).then(r=>r.json());
    assert.equal(exposed.persona.prompt,p.systemPrompt);
    assert.equal(exposed.persona.futureSecret,undefined);
    for (const [method,path] of [['GET','admin/personas'],['POST','admin/personas'],['PATCH','admin/personas/moonlight'],['DELETE','admin/personas/moonlight']]) {
      const r=await handleApi(new Request('https://example.test/api/'+path,{method,headers:{Origin:'https://example.test','Content-Type':'application/json'},body:method==='GET'?undefined:'{}'}),env);
      assert.equal(r.status,401);
    }
    assert.equal(JSON.parse((await db.prepare('SELECT data FROM personas WHERE id=?').bind('moonlight').first()).data).futureSecret,'fixture-internal');
  } finally { await closeDatabases(); await rm(dir,{recursive:true,force:true}); }
});

test('build never connects to a configured database and leaves static preview untouched', async () => {
  const before = await readFile(new URL('../preview-dist/js/app.js',import.meta.url));
  // Isolated fake environment only: do not inherit local credentials or network configuration.
  const env={PATH:process.env.PATH,DATABASE_URL:'postgres://not-a-real-database.invalid/test',AI_ENABLED:'false'};
  const result=await execute(process.execPath,['scripts/build.js'],{env,encoding:'utf8',timeout:30000});
  assert.match(result.stdout,/migration skipped by design/);
  assert.deepEqual(await readFile(new URL('../preview-dist/js/app.js',import.meta.url)),before);
});

test('production migration CLI refuses to connect without explicit confirmation', async () => {
  await assert.rejects(execute(process.execPath,['scripts/migrate.js'],{env:{PATH:process.env.PATH,NODE_ENV:'production',AI_ENABLED:'false'},encoding:'utf8',timeout:5000}), error => error.code === 1 && /--confirm-production/.test(error.stderr));
});
