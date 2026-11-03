import { ApiError, json, readJson, sha256, randomToken, equalSecret } from './security.js';
const COOKIE = 'pv_session';
const DAY = 86400000;
function credentials(env) {
  const email = String(env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(env.ADMIN_PASSWORD || '');
  return email && password.length >= 12 ? { email, password } : null;
}
function cookie(request, value, seconds) {
  return `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${seconds}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
async function credentialHash(config) { return sha256(config.email + '\0' + config.password); }
export async function getIdentity(request, env, db) {
  const config = credentials(env); if (!config) return null;
  const token = request.headers.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const record = await db.prepare('SELECT email,credential_hash,expires_at FROM sessions WHERE token_hash=?').bind(await sha256(token)).first();
  if (!record || record.expires_at <= new Date().toISOString() || record.email !== config.email || record.credential_hash !== await credentialHash(config)) return null;
  return { id: 'admin', email: config.email, role: 'admin' };
}
export async function handleAuth(request, env, db) {
  const route = new URL(request.url).pathname;
  if (request.method !== 'POST' || !['/api/auth/login', '/api/auth/logout'].includes(route)) return null;
  if (route.endsWith('/logout')) {
    const token = request.headers.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
    if (token && /^[0-9a-f]{64}$/.test(token)) await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(token)).run();
    return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, '', 0) });
  }
  const config = credentials(env);
  if (!config) throw new ApiError(503, 'ADMIN_NOT_CONFIGURED', '管理员尚未配置，请在服务端设置 ADMIN_EMAIL 和至少12字符的 ADMIN_PASSWORD。');
  const body = await readJson(request);
  if (typeof body.email !== 'string' || body.email.length > 254 || typeof body.password !== 'string' || body.password.length > 1024) throw new ApiError(400, 'INVALID_CREDENTIALS', '请填写有效的邮箱和密码。');
  const now = new Date(); const cutoff = new Date(now.getTime() - 15 * 60000).toISOString();
  const key = await sha256('admin-login:' + config.email);
  const attempt = await db.prepare(`INSERT INTO login_attempts(key,count,window_start) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN login_attempts.window_start<? THEN 1 ELSE login_attempts.count+1 END,window_start=CASE WHEN login_attempts.window_start<? THEN excluded.window_start ELSE login_attempts.window_start END RETURNING count`).bind(key, now.toISOString(), cutoff, cutoff).first();
  if (Number(attempt.count) > 10) throw new ApiError(429, 'LOGIN_RATE_LIMITED', '尝试次数过多，请15分钟后重试。');
  const valid = await equalSecret(body.password, config.password);
  if (!valid || body.email.trim().toLowerCase() !== config.email) throw new ApiError(401, 'INVALID_CREDENTIALS', '邮箱或密码不正确。');
  const token = randomToken(); const hash = await sha256(token);
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(now.toISOString()),
    db.prepare('INSERT INTO sessions(token_hash,email,credential_hash,expires_at) VALUES (?,?,?,?)').bind(hash, config.email, await credentialHash(config), new Date(now.getTime() + DAY).toISOString()),
    db.prepare('DELETE FROM login_attempts WHERE key=?').bind(key)
  ]);
  return json({ user: { id: 'admin', email: config.email, role: 'admin' } }, 200, { 'Set-Cookie': cookie(request, token, 86400) });
}
