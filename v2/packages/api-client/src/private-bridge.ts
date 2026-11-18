// Server-only capability: never expose the shared secret in browser bundles.
import { isIP } from 'node:net';
const names = ['x-pv-ip', 'x-pv-time', 'x-pv-proof'];
async function key(secret: string) {
  if (secret.length < 32) throw new Error('BRIDGE_SECRET_REQUIRED');
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}
function bytes(request: Request, ip: string, time: string) {
  return new TextEncoder().encode([request.method, request.url, ip, time].join('\n'));
}
export async function signBridge(request: Request, secret: string, ip: string) {
  if (!isIP(ip) && !(ip === 'ssr' && ['GET', 'HEAD'].includes(request.method)))
    throw new Error('INVALID_CLIENT_IP');
  const headers = new Headers(request.headers);
  for (const name of ['forwarded', 'x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', ...names])
    headers.delete(name);
  const time = String(Date.now());
  const proof = await crypto.subtle.sign('HMAC', await key(secret), bytes(request, ip, time));
  headers.set(names[0]!, ip);
  headers.set(names[1]!, time);
  headers.set(names[2]!, Buffer.from(proof).toString('hex'));
  return new Request(request, { headers });
}
export async function verifyBridge(request: Request, secret: string) {
  const ip = request.headers.get(names[0]!) ?? '';
  const time = request.headers.get(names[1]!) ?? '';
  const proof = request.headers.get(names[2]!) ?? '';
  if (
    (!isIP(ip) && !(ip === 'ssr' && ['GET', 'HEAD'].includes(request.method))) ||
    !/^\d+$/.test(time) ||
    Math.abs(Date.now() - Number(time)) > 10000 ||
    !/^[a-f0-9]{64}$/.test(proof)
  )
    return null;
  return (await crypto.subtle.verify(
    'HMAC',
    await key(secret),
    Buffer.from(proof, 'hex'),
    bytes(request, ip, time),
  ))
    ? ip
    : null;
}
export function internalHeaders(request: Request) {
  return names.some((name) => request.headers.has(name));
}
