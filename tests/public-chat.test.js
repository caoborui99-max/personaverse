import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {getDatabase,migrateDatabase,closeDatabases} from '../server/database.js';
import {initializeData,handleApi} from '../server/handler.js';
import {seedPersonas} from '../server/seed-data.js';

async function fixture(run) {
  const dir = await mkdtemp(join(tmpdir(), 'pv-public-'));
  const env = {SQLITE_PATH: join(dir, 'fixture.sqlite'), AI_ENABLED: 'true', AI_CHAT_ACCESS: 'public',
    AI_BASE_URL: 'https://api.deepseek.com/v1', AI_MODEL: 'fixture-model', AI_API_KEY: 'fixture-not-a-real-key', AI_DAILY_LIMIT: '20'};
  let clock = Date.now(); const calls = [];
  const provider = {complete: async messages => {calls.push(messages); return 'Offline fixture response';}};
  const call = async (path, body, cookie = '', overrides = {}) => {
    const response = await handleApi(new Request('https://example.test/api/' + path, {
      method: body === undefined ? 'GET' : 'POST', headers: {Origin: 'https://example.test', 'Content-Type': 'application/json', Cookie: cookie},
      body: body === undefined ? undefined : JSON.stringify(body)
    }), env, {provider, now: () => clock, ...overrides});
    return {response, data: await response.json()};
  };
  const session = async () => {
    const result = await call('ai/session', {});
    assert.equal(result.response.status, 201);
    const header = result.response.headers.get('set-cookie');
    assert.match(header, /HttpOnly; SameSite=Strict; Path=\/api\/ai; Max-Age=86400; Secure/);
    return header.split(';')[0];
  };
  try {
    const db = await getDatabase(env); await migrateDatabase(db); await initializeData(db);
    await run({env, db, calls, call, session, minute: () => {clock += 60000;}, day: () => {clock += 86400000;}});
  } finally {await closeDatabases(); await rm(dir, {recursive: true, force: true});}
}
const message = (personaId = 'moonlight', extra = {}) => ({personaId, message: 'fixture user input', requestId: randomUUID(), ...extra});

test('public chat uses all twelve DB personas and preserves profiles, multi-turn history and ID deduplication', () => fixture(async ({env,db,call,session,calls,minute}) => {
  const before = (await db.prepare('SELECT id,data FROM personas ORDER BY id').all()).results;
  const cookie = await session(); assert.equal(calls.length, 0);
  assert.equal((await call('ai/session', {}, cookie)).response.status, 200);
  let first;
  for (const p of seedPersonas) {
    const body = message(p.id);
    const result = await call('ai/chat', body, cookie);
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    assert.equal(calls.at(-1)[0].content.includes(p.systemPrompt || p.prompt), true);
    const n = calls.length;
    assert.deepEqual((await call('ai/chat', body, cookie)).data, result.data); assert.equal(calls.length, n);
    if (!first) first = result.data;
    minute();
  }
  const continued = await call('ai/chat', message('moonlight', {threadId: first.threadId}), cookie);
  assert.equal(continued.response.status, 200);
  assert.equal(calls.at(-1).some(m => m.role === 'assistant' && m.content === 'Offline fixture response'), true);
  assert.equal((await call('ai/history?threadId=' + first.threadId, undefined, cookie)).data.messages.length, 4);
  assert.deepEqual((await db.prepare('SELECT id,data FROM personas ORDER BY id').all()).results, before);
  assert.equal(JSON.stringify((await call('ai/status')).data).includes(env.AI_API_KEY), false);
}));

test('visitor cookies cannot elevate to admin, read another history, replace prompts or access private/unpublished personas', () => fixture(async ({db,call,session,calls,minute}) => {
  const a = await session(), b = await session();
  const first = await call('ai/chat', message(), a); assert.equal(first.response.status, 200); minute();
  assert.equal((await call('ai/history?threadId=' + first.data.threadId, undefined, b)).response.status, 404);
  assert.equal((await call('ai/chat', message('moonlight', {threadId: first.data.threadId}), b)).response.status, 404);
  assert.equal((await call('admin/personas', undefined, a)).response.status, 401);
  assert.equal((await call('ai/chat', message('moonlight', {systemPrompt: 'override'}), a)).response.status, 400);
  assert.equal((await call('ai/chat', message(), 'pv_chat_session=' + 'a'.repeat(64))).response.status, 401);
  assert.equal((await call('ai/session', {role: 'admin'})).response.status, 400);
  const row = await db.prepare("SELECT data FROM personas WHERE id='muse'").first();
  await db.prepare("UPDATE personas SET data=? WHERE id='muse'").bind(JSON.stringify({...JSON.parse(row.data), isPublic: false})).run();
  assert.equal((await call('ai/chat', message('muse'), a)).response.status, 404);
  await db.prepare("UPDATE personas SET status='archived' WHERE id='mentor'").run();
  assert.equal((await call('ai/chat', message('mentor'), a)).response.status, 404);
  assert.equal(calls.length, 1);
}));

test('public rate and global daily ceilings survive a new visitor, failures, replay and database reopen', () => fixture(async ({env,db,call,session,calls,minute}) => {
  env.AI_DAILY_LIMIT = '2';
  const a = await session();
  assert.equal((await call('ai/chat', message(), a)).response.status, 200);
  assert.equal((await call('ai/chat', message(), a)).data.error.code, 'AI_RATE_LIMIT'); minute();
  let attempts = 0;
  const failing = {complete: async () => {attempts++; throw Error('private fixture upstream details');}};
  const body = message();
  const result = await call('ai/chat', body, a, {provider: failing});
  assert.equal(result.response.status, 500); assert.equal(JSON.stringify(result.data).includes('private fixture'), false);
  assert.equal((await call('ai/chat', body, a, {provider: failing})).response.status, 409); assert.equal(attempts, 1);
  await closeDatabases(); await getDatabase(env);
  const b = await session();
  assert.equal((await call('ai/chat', message(), b)).data.error.code, 'AI_DAILY_LIMIT'); assert.equal(calls.length, 1);
}));

test('AI and access gates fail closed; expired sessions and cross-origin issuance never call a provider', () => fixture(async ({env,db,call,session,calls,day}) => {
  const cookie = await session(); day();
  assert.equal((await call('ai/chat', message(), cookie)).response.status, 401);
  for (const change of [{AI_ENABLED: 'false'}, {AI_API_KEY: ''}]) {
    const original = {...env}; Object.assign(env, change);
    assert.equal((await call('ai/session', {})).response.status, 503);
    assert.equal((await call('ai/chat', message(), cookie)).response.status, 401);
    Object.assign(env, original);
  }
  for (const key of ['AI_DAILY_LIMIT', 'AI_RATE_LIMIT']) {
    const original = env[key]; env[key] = '999999';
    assert.equal((await call('ai/status')).response.status, 503);
    if (original === undefined) delete env[key]; else env[key] = original;
  }
  const bad = await handleApi(new Request('https://example.test/api/ai/session', {method: 'POST', headers: {Origin: 'https://other.test', 'Content-Type': 'application/json'}, body: '{}'}), env);
  assert.equal(bad.status, 403);
  env.AI_CHAT_ACCESS = 'admin'; assert.equal((await call('ai/session', {})).response.status, 401);
  assert.equal((await call('ai/status')).data.dailyLimit, 1); assert.equal(calls.length, 0);
}));
