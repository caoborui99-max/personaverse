import {ApiError, json, randomToken, readJson, sha256} from './security.js';

const COOKIE = 'pv_chat_session';
const MARKER = 'visitor-chat-v1';
const DAY = 86400000;

// Existing isolation tests remain admin-only and cannot raise their fixed limits.
// Public access is a separate, explicit server-side opt-in; it never enables AI.
export function chatAccess(env) {
  const access = env.AI_CHAT_ACCESS || 'admin';
  if (!['admin', 'public'].includes(access)) throw new ApiError(503, 'CHAT_CONFIG_INVALID', '聊天访问配置无效。');
  if (access === 'admin') return {public: false, dailyLimit: 1, rateLimit: 1};
  function limit(key, max) {
    const value = env[key] === undefined || env[key] === '' ? 1 : Number(env[key]);
    if (!Number.isInteger(value) || value < 1 || value > max) throw new ApiError(503, 'CHAT_CONFIG_INVALID', '聊天额度配置无效。');
    return value;
  }
  return {public: true, dailyLimit: limit('AI_DAILY_LIMIT', 100), rateLimit: limit('AI_RATE_LIMIT', 3)};
}

function tokenFrom(request) {
  const token = request.headers.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
  return token && /^[0-9a-f]{64}$/.test(token) ? token : null;
}

export async function visitorIdentity(request, db, now) {
  const token = tokenFrom(request);
  if (!token) return null;
  const row = await db.prepare('SELECT email,credential_hash,expires_at FROM sessions WHERE token_hash=?').bind(await sha256(token)).first();
  if (!row || row.credential_hash !== MARKER || !/^visitor:[0-9a-f-]{36}$/.test(row.email) || row.expires_at <= now.toISOString()) return null;
  return {role: 'visitor', email: row.email};
}

// This creates only a browser session. It never calls the AI Provider.
export async function openVisitorSession(request, db, now) {
  const body = await readJson(request);
  if (Object.keys(body).length) throw new ApiError(400, 'INVALID_CHAT_SESSION', '会话创建不接受身份或权限参数。');
  if (await visitorIdentity(request, db, now)) return json({ok: true});
  const token = randomToken();
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE credential_hash=? AND expires_at<=?').bind(MARKER, now.toISOString()),
    db.prepare('INSERT INTO sessions(token_hash,email,credential_hash,expires_at) VALUES (?,?,?,?)').bind(await sha256(token), 'visitor:' + crypto.randomUUID(), MARKER, new Date(now.getTime() + DAY).toISOString())
  ]);
  return json({ok: true}, 201, {'Set-Cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api/ai; Max-Age=86400${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`});
}
