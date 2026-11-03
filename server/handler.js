import { getDatabase } from './database.js';
import { ApiError, json, readJson, requireSameOrigin } from './security.js';
import { getIdentity, handleAuth } from './auth.js';
import { seedPersonas } from './seed-data.js';

const categorySeeds = ['情感陪伴', '效率工具', '学习成长', '创意灵感', '趣味角色'];
const accents = ['purple', 'cyan', 'rose', 'amber', 'green', 'blue'];
const icons = ['moon', 'spark', 'compass', 'pen', 'code', 'book', 'coffee', 'music', 'leaf', 'planet'];
const marker = 'catalog_seed_v1';
export async function initializeData(db) {
  if (await db.prepare('SELECT value FROM settings WHERE key=?').bind(marker).first()) return;
  const statements = categorySeeds.map((name, index) => db.prepare('INSERT INTO categories(id,name,sort_order) SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key=?) ON CONFLICT(id) DO NOTHING').bind('category-' + index, name, index, marker));
  for (const [index, p] of seedPersonas.entries()) {
    const data = { ...p, categoryId: 'category-' + categorySeeds.indexOf(p.category), avatarUrl: '', systemPrompt: p.prompt, copyEnabled: true, status: 'published', sortOrder: index, welcomeMessage: '', exampleQuestions: [] };
    delete data.prompt;
    statements.push(db.prepare('INSERT INTO personas(id,data,status,sort_order) SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key=?) ON CONFLICT(id) DO NOTHING').bind(p.id, JSON.stringify(data), 'published', index, marker));
  }
  statements.push(db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO NOTHING').bind(marker, new Date().toISOString()));
  await db.batch(statements);
}
async function categories(db) { return (await db.prepare('SELECT id,name,sort_order FROM categories ORDER BY sort_order,id').all()).results.map(row => ({ id: row.id, name: row.name, sortOrder: Number(row.sort_order) })); }
function record(row) { return row ? { ...JSON.parse(row.data), id: row.id, status: row.status, sortOrder: Number(row.sort_order) } : null; }
function publicPersona(p, cats) {
  const { systemPrompt, ...safe } = p;
  safe.category = cats.find(c => c.id === p.categoryId)?.name || p.category || '';
  if (p.copyEnabled) safe.prompt = systemPrompt;
  return safe;
}
function validated(input, previous, cats) {
  const p = previous ? { ...previous } : { id: 'persona-' + crypto.randomUUID(), name: '', englishName: '', description: '', tagline: '', avatarUrl: '', categoryId: '', tags: [], icon: 'planet', accent: 'purple', systemPrompt: '', welcomeMessage: '', starters: [], exampleQuestions: [], status: 'draft', sortOrder: 0, featured: false, copyEnabled: false };
  const limits = { name: 80, englishName: 80, description: 2000, tagline: 160, avatarUrl: 2000, categoryId: 100, systemPrompt: 20000, welcomeMessage: 2000 };
  for (const [key, max] of Object.entries(limits)) if (Object.hasOwn(input, key)) {
    if (typeof input[key] !== 'string' || input[key].length > max) throw new ApiError(400, 'INVALID_FIELD', `${key} 格式错误或内容过长。`);
    p[key] = input[key].trim();
  }
  for (const key of ['tags', 'starters', 'exampleQuestions']) if (Object.hasOwn(input, key)) {
    if (!Array.isArray(input[key]) || input[key].length > 12 || input[key].some(x => typeof x !== 'string' || x.length > 300)) throw new ApiError(400, 'INVALID_FIELD', `${key} 必须是最多12个短文本。`);
    p[key] = input[key].map(x => x.trim()).filter(Boolean);
  }
  for (const key of ['featured', 'copyEnabled']) if (Object.hasOwn(input, key)) { if (typeof input[key] !== 'boolean') throw new ApiError(400, 'INVALID_FIELD', `${key} 必须是布尔值。`); p[key] = input[key]; }
  if (Object.hasOwn(input, 'sortOrder')) { if (!Number.isInteger(input.sortOrder) || Math.abs(input.sortOrder) > 100000) throw new ApiError(400, 'INVALID_FIELD', '排序必须是整数。'); p.sortOrder = input.sortOrder; }
  if (Object.hasOwn(input, 'status')) { if (!['draft', 'published', 'archived'].includes(input.status)) throw new ApiError(400, 'INVALID_STATUS', '人格状态无效。'); p.status = input.status; }
  if (Object.hasOwn(input, 'icon')) { if (!icons.includes(input.icon)) throw new ApiError(400, 'INVALID_ICON', '请选择支持的图标。'); p.icon = input.icon; }
  if (Object.hasOwn(input, 'accent')) { if (!accents.includes(input.accent)) throw new ApiError(400, 'INVALID_ACCENT', '请选择支持的颜色。'); p.accent = input.accent; }
  if (p.avatarUrl) { let url; try { url = new URL(p.avatarUrl); } catch {} if (!url || url.protocol !== 'https:' || url.username || url.password) throw new ApiError(400, 'INVALID_AVATAR', '头像必须是有效的 HTTPS 图片地址。'); }
  if (p.categoryId && !cats.some(c => c.id === p.categoryId)) throw new ApiError(400, 'INVALID_CATEGORY', '请选择有效分类。');
  if (!p.name) throw new ApiError(400, 'NAME_REQUIRED', '请填写人格名称。');
  if (p.status === 'published' && (!p.description || !p.systemPrompt || !p.categoryId)) throw new ApiError(400, 'PUBLISH_INCOMPLETE', '发布需要填写简介、分类和系统提示词。');
  p.category = cats.find(c => c.id === p.categoryId)?.name || '';
  return p;
}
export async function handleApi(request, env = {}, options = {}) {
  try {
    requireSameOrigin(request);
    const path = new URL(request.url).pathname.replace(/\/$/, '');
    let db;
    try { db = await getDatabase(env); }
    catch (error) {
      if (path === '/api/session') return json({ user: null, auth: { provider: 'local', registrationEnabled: false }, config: { databaseReady: false, chatConfigured: false }, error: { code: error.code || 'DATABASE_NOT_CONFIGURED', message: '请先配置持久化数据库。' } });
      throw error;
    }
    const authResponse = await handleAuth(request, env, db, options); if (authResponse) return authResponse;
    const user = await getIdentity(request, env, db, options);
    if (path === '/api/session' && request.method === 'GET') return json({ user, auth: { provider: 'local', registrationEnabled: false }, config: { databaseReady: true, chatConfigured: false, adminConfigured: !!env.ADMIN_EMAIL && String(env.ADMIN_PASSWORD || '').length >= 12 } });
    const admin = path === '/api/admin/personas' || path.startsWith('/api/admin/');
    if (admin && user?.role !== 'admin') throw new ApiError(401, 'ADMIN_REQUIRED', '请先使用管理员账号登录。');
    const cats = await categories(db);
    if (path === '/api/personas' && request.method === 'GET') {
      const rows = await db.prepare('SELECT id,data,status,sort_order FROM personas WHERE status=? ORDER BY sort_order,id').bind('published').all();
      return json({ personas: rows.results.map(row => publicPersona(record(row), cats)), categories: cats, databaseReady: true, chatConfigured: false });
    }
    const publicMatch = path.match(/^\/api\/personas\/([^/]+)$/);
    if (publicMatch && request.method === 'GET') {
      const p = record(await db.prepare('SELECT id,data,status,sort_order FROM personas WHERE id=? AND status=?').bind(decodeURIComponent(publicMatch[1]), 'published').first());
      if (!p) throw new ApiError(404, 'PERSONA_NOT_FOUND', '人格不存在或尚未上架。');
      return json({ persona: publicPersona(p, cats), chatConfigured: false });
    }
    if (path === '/api/admin/personas') {
      if (request.method === 'GET') {
        const rows = await db.prepare('SELECT id,data,status,sort_order FROM personas WHERE status<>? ORDER BY sort_order,id').bind('deleted').all();
        return json({ personas: rows.results.map(record), categories: cats });
      }
      if (request.method === 'POST') {
        const p = validated(await readJson(request), null, cats);
        await db.prepare('INSERT INTO personas(id,data,status,sort_order) VALUES (?,?,?,?)').bind(p.id, JSON.stringify(p), p.status, p.sortOrder).run();
        return json({ persona: p }, 201);
      }
    }
    const match = path.match(/^\/api\/admin\/personas\/([^/]+)$/);
    if (match && ['PATCH', 'DELETE'].includes(request.method)) {
      const id = decodeURIComponent(match[1]);
      const old = record(await db.prepare('SELECT id,data,status,sort_order FROM personas WHERE id=? AND status<>?').bind(id, 'deleted').first());
      if (!old) throw new ApiError(404, 'PERSONA_NOT_FOUND', '人格不存在。');
      if (request.method === 'DELETE') { await db.prepare('UPDATE personas SET status=? WHERE id=?').bind('deleted', id).run(); return json({ ok: true }); }
      const p = validated(await readJson(request), old, cats);
      await db.prepare('UPDATE personas SET data=?,status=?,sort_order=? WHERE id=?').bind(JSON.stringify(p), p.status, p.sortOrder, id).run();
      return json({ persona: p });
    }
    throw new ApiError(404, 'API_NOT_FOUND', '接口不存在。');
  } catch (error) {
    if (error instanceof ApiError) return json({ error: { code: error.code, message: error.message } }, error.status);
    if (error instanceof URIError) return json({ error: { code: 'INVALID_PATH', message: '链接格式错误。' } }, 400);
    console.error('PersonaVerse API failure', error?.name || 'UnknownError');
    return json({ error: { code: 'SERVER_ERROR', message: '服务器暂时无法完成请求，请稍后重试。' } }, 500);
  }
}
