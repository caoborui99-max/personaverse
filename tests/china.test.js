import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,readFile,writeFile,symlink,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {getDatabase,migrateDatabase,closeDatabases} from '../server/database.js';
import {initializeData,handleApi} from '../server/handler.js';
import {requestOrigin,validateServerEnvironment} from '../server/deployment.js';
import {backupDatabase,restoreNewFile,verifyRestore,validateBackup} from '../scripts/sqlite-maintenance.js';
const request=(headers={},remote='127.0.0.1')=>({headers:{host:'test.example','x-forwarded-proto':'https',...headers},socket:{remoteAddress:remote}});
const env={NODE_ENV:'production',APP_ORIGIN:'https://test.example',TRUST_PROXY:'loopback'};
test('fixed HTTPS origin trusts only loopback proxy and rejects spoofed hosts/protocols',()=>{
 assert.equal(requestOrigin(request(),env),'https://test.example');
 assert.equal(requestOrigin(request({'x-forwarded-host':'evil.example'}),env),'https://test.example');
 assert.throws(()=>requestOrigin(request({},'203.0.113.10'),env),e=>e.code==='PROXY_REJECTED');
 assert.throws(()=>requestOrigin(request({'x-forwarded-proto':'http'}),env),e=>e.code==='PROXY_SCHEME_REJECTED');
 assert.throws(()=>requestOrigin(request({host:'evil.example'}),env),e=>e.code==='HOST_REJECTED');
 assert.throws(()=>requestOrigin(request(),{NODE_ENV:'production'}),e=>e.code==='ORIGIN_NOT_CONFIGURED');
 assert.throws(()=>validateServerEnvironment({...env,ADMIN_EMAIL:'admin@example.test',ADMIN_PASSWORD:'short'}));
 assert.throws(()=>requestOrigin(request(),{...env,APP_ORIGIN:'http://test.example'}));
 assert.equal(requestOrigin(request({'x-forwarded-proto':'https'}),{}),'http://test.example');
});
test('production SQLite requires explicit persistent storage, blocks temp and serverless paths',async()=>{
 const base={NODE_ENV:'production',DATABASE_DRIVER:'sqlite'};
 await assert.rejects(()=>getDatabase(base),e=>e.code==='SQLITE_PATH_REQUIRED');
 for(const path of ['/tmp/unsafe.sqlite','/var/tmp/unsafe.sqlite','/dev/shm/a.sqlite','/run/a.sqlite'])await assert.rejects(()=>getDatabase({...base,SQLITE_PATH:path}),e=>e.code==='SQLITE_PATH_UNSAFE');
 await assert.rejects(()=>getDatabase({...base,VERCEL:'1',SQLITE_PATH:'/var/lib/personaverse/a.sqlite'}),e=>e.code==='DATABASE_NOT_CONFIGURED');
 await assert.rejects(()=>getDatabase({...base,DATABASE_URL:'not-a-secret',SQLITE_PATH:'/var/lib/a.sqlite'}),e=>e.code==='DATABASE_CONFIG_CONFLICT');
});
test('production database survives reopen; consistent WAL backup and isolated restore never overwrite data',async()=>{
 await mkdir('.local',{recursive:true});const dir=await mkdtemp(resolve('.local/cn-test-'));
 try{
 const source=join(dir,'live.sqlite'),settings={NODE_ENV:'production',DATABASE_DRIVER:'sqlite',SQLITE_PATH:source};
 let db=await getDatabase(settings);await migrateDatabase(db);await initializeData(db);
 await db.prepare('INSERT INTO settings(key,value) VALUES (?,?)').bind('preserve','重要原始内容').run();
 const file=await backupDatabase(source,join(dir,'backups'));await verifyRestore(file);const meta=await validateBackup(file);assert.equal(meta.sha256.length,64);assert.equal((await stat(file)).mode&0o777,0o600);
 const restored=await restoreNewFile(file,join(dir,'restore.sqlite'));
 const other=await getDatabase({SQLITE_PATH:restored});assert.equal((await other.prepare('SELECT value FROM settings WHERE key=?').bind('preserve').first()).value,'重要原始内容');
 await assert.rejects(()=>restoreNewFile(file,source),e=>e.code==='EEXIST');
 assert.equal((await db.prepare('SELECT value FROM settings WHERE key=?').bind('preserve').first()).value,'重要原始内容');
 const manifest=JSON.parse(await readFile(file+'.json','utf8'));await writeFile(file+'.json',JSON.stringify({...manifest,sha256:'0'.repeat(64)}));await assert.rejects(()=>restoreNewFile(file,join(dir,'bad.sqlite')));
 await writeFile(file+'.json',JSON.stringify(manifest));
 await closeDatabases();db=await getDatabase(settings);await migrateDatabase(db);await initializeData(db);assert.equal((await db.prepare('SELECT value FROM settings WHERE key=?').bind('preserve').first()).value,'重要原始内容');
 await symlink('/tmp',join(dir,'temp-link'));await assert.rejects(()=>getDatabase({...settings,SQLITE_PATH:join(dir,'temp-link','must-not-create.sqlite')}),e=>e.code==='SQLITE_PATH_UNSAFE');
 const status=await handleApi(new Request('https://test.example/api/ai/status'),settings);assert.equal((await status.json()).mode,'demo');
 }finally{await closeDatabases();await rm(dir,{recursive:true,force:true});}
});
test('single-server entry fails before startup if paid AI switch is enabled',async()=>{
 const {spawnSync}=await import('node:child_process');
 const r=spawnSync(process.execPath,['scripts/start-single-server.js'],{env:{...process.env,NODE_ENV:'production',AI_ENABLED:'true'},encoding:'utf8'});
 assert.notEqual(r.status,0);assert.ok(r.stderr.includes('requires AI_ENABLED=false'));
});
