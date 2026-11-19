import { internalHeaders, signBridge } from '../../packages/api-client/src/private-bridge.ts';
import { previewPath } from '../mock-preview/policy.ts';
import { productionOrigin as previewOrigin } from './policy.ts';
export async function gateway(
  request: Request,
  env: {
    WEB_ORIGIN: string;
    BRIDGE_SECRET: string;
    API: { fetch(request: Request): Promise<Response> };
  },
  render: () => Promise<Response>,
) {
  try {
    if (new URL(request.url).origin !== previewOrigin(env.WEB_ORIGIN))
      return new Response('Origin unavailable', { status: 421 });
    const path = decodeURIComponent(new URL(request.url).pathname);
    if (path.includes('\\') || path.includes('//') || path.startsWith('/__local'))
      return new Response('Not found', { status: 404 });
    if (internalHeaders(request))
      return new Response('Untrusted forwarding headers', { status: 403 });
    if (path.startsWith('/auth/rengine') || path.startsWith('/api/v1/auth/rengine'))
      return new Response('Not found', { status: 404 });
    if (previewPath(request)) {
      // Cloudflare overwrites this header on real external ingress. Never accept X-Forwarded-For.
      const ip = request.headers.get('cf-connecting-ip') ?? '';
      if (!(request as Request & { cf?: unknown }).cf)
        return new Response('Trusted edge required', { status: 403 });
      return await env.API.fetch(await signBridge(request, env.BRIDGE_SECRET, ip));
    }
    return await render();
  } catch {
    return new Response('Preview unavailable', { status: 503 });
  }
}
