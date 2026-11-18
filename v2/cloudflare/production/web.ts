import web from '../../apps/web/.open-next/worker.js';
import { gateway } from './gateway.ts';
export default {
  fetch(
    request: Request,
    env: Record<string, unknown> & {
      WEB_ORIGIN: string;
      BRIDGE_SECRET: string;
      API: { fetch(request: Request): Promise<Response> };
    },
    ctx: unknown,
  ) {
    return gateway(request, env, () => web.fetch(request, env, ctx));
  },
};
