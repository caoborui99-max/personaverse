// OpenNext artifact is generated only by the isolated local build.
import web from '../apps/web/.open-next/worker.js';
export default {
  async fetch(
    request: Request,
    env: Record<string, unknown> & { API: { fetch: (request: Request) => Promise<Response> } },
    ctx: unknown,
  ) {
    if (new URL(request.url).pathname.match(/^\/(?:api\/v1\/|__local\/)/))
      return env.API.fetch(request);
    return web.fetch(request, env, ctx);
  },
};
