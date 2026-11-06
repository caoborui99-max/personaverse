export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
}
export function requireSameOrigin(request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  if (request.headers.get('origin') !== new URL(request.url).origin) throw new ApiError(403, 'ORIGIN_REJECTED', '请求来源与服务端站点地址不一致，请核对 APP_ORIGIN 与可信 HTTPS 代理配置。');
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw new ApiError(403, 'ORIGIN_REJECTED', '请从本站页面发起操作。');
  if (request.body && request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new ApiError(415, 'JSON_REQUIRED', '请使用 JSON 提交。');
}
export async function readJson(request) {
  if (!request.body) throw new ApiError(400, 'INVALID_JSON', '请求内容不能为空。');
  const reader = request.body.getReader(); const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 65536) { await reader.cancel(); throw new ApiError(413, 'BODY_TOO_LARGE', '提交内容过长。'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new ApiError(400, 'INVALID_JSON', '请求不是有效的 JSON。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'INVALID_JSON', '请求内容必须为对象。');
  return value;
}
export async function sha256(value) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), n => n.toString(16).padStart(2, '0')).join(''); }
export function randomToken() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join(''); }
export async function equalSecret(a, b) {
  const [left, right] = await Promise.all([sha256(String(a)), sha256(String(b))]); let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}
