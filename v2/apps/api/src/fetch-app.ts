import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
// Deliberately narrow transport adapter, not a Fastify implementation. Registration uses only
// these methods; an unsupported extension fails immediately instead of silently skipping hooks.
type Handler = (request: FastifyRequest, reply: FastifyReply) => unknown | Promise<unknown>;
type ErrorHandler = (error: Error, request: FastifyRequest, reply: FastifyReply) => unknown;
class Reply {
  status = 200;
  headers = new Headers();
  sent = false;
  value: unknown;
  code(status: number) {
    this.status = status;
    return this;
  }
  header(name: string, value: string) {
    this.headers.set(name, value);
    return this;
  }
  send(value: unknown) {
    this.value = value;
    this.sent = true;
    return this;
  }
  response(head = false) {
    if (!this.headers.has('content-type'))
      this.headers.set('content-type', 'application/json; charset=utf-8');
    return new Response(head || this.status === 204 ? null : JSON.stringify(this.value ?? null), {
      status: this.status,
      headers: this.headers,
    });
  }
}
export function createFetchApp() {
  const routes: { method: string; parts: string[]; handler: Handler }[] = [];
  const hooks: Handler[] = [];
  const closing: (() => Promise<void>)[] = [];
  let errorHandler: ErrorHandler | undefined, notFound: Handler | undefined;
  function route(method: string, path: string, handler: Handler) {
    if (routes.some((r) => r.method === method && r.parts.join('/') === path))
      throw new Error('DUPLICATE_ROUTE');
    routes.push({ method, parts: path.split('/'), handler });
    return api;
  }
  const api = {
    get: (path: string, handler: Handler) => route('GET', path, handler),
    post: (path: string, handler: Handler) => route('POST', path, handler),
    put: (path: string, handler: Handler) => route('PUT', path, handler),
    delete: (path: string, handler: Handler) => route('DELETE', path, handler),
    addHook(name: string, handler: Handler | (() => Promise<void>)) {
      if (name === 'onRequest') hooks.push(handler as Handler);
      else if (name === 'onClose') closing.push(handler as () => Promise<void>);
      else throw new Error('UNSUPPORTED_HOOK');
      return api;
    },
    setErrorHandler(handler: ErrorHandler) {
      errorHandler = handler;
      return api;
    },
    setNotFoundHandler(handler: Handler) {
      notFound = handler;
      return api;
    },
    async ready() {
      if (!errorHandler || !notFound) throw new Error('INCOMPLETE_REGISTRATION');
    },
    async close() {
      for (const handler of closing) await handler();
    },
    async fetch(input: Request) {
      const reply = new Reply();
      const url = new URL(input.url);
      const req = {
        id: crypto.randomUUID(),
        method: input.method,
        url: url.pathname + url.search,
        headers: (() => {
          const values: Record<string, string> = {};
          input.headers.forEach((v, k) => {
            values[k] = v;
          });
          return values;
        })(),
        params: Object.create(null),
        query: Object.create(null),
        body: undefined,
        // No arbitrary forwarding header is trusted. Service Binding identity is not a public IP.
        ip: 'local-service-binding',
      } as unknown as FastifyRequest;
      const respond = reply as unknown as FastifyReply;
      try {
        // Auth/origin hooks run even on unknown routes and before parsing potentially large bodies.
        for (const handler of hooks) {
          await handler(req, respond);
          if (reply.sent) return reply.response(input.method === 'HEAD');
        }
        if (
          url.pathname.includes('%2f') ||
          url.pathname.includes('%2F') ||
          url.pathname.includes('%5c') ||
          url.pathname.includes('%5C')
        )
          throw Object.assign(new Error('ENCODED_SEPARATOR'), { statusCode: 400 });
        const parts = url.pathname.split('/');
        const method = input.method === 'HEAD' ? 'GET' : input.method;
        const found = routes.find(
          (r) =>
            r.method === method &&
            r.parts.length === parts.length &&
            r.parts.every((p, i) => p.startsWith(':') || p === parts[i]),
        );
        const params: Record<string, string> = Object.create(null);
        found?.parts.forEach((p, i) => {
          if (p.startsWith(':'))
            try {
              params[p.slice(1)] = decodeURIComponent(parts[i]!);
            } catch {
              throw Object.assign(new Error('INVALID_PATH_ENCODING'), { statusCode: 400 });
            }
        });
        req.params = params;
        const query: Record<string, string | string[]> = Object.create(null);
        for (const [key, value] of url.searchParams) {
          const old = query[key];
          query[key] =
            old === undefined ? value : Array.isArray(old) ? [...old, value] : [old, value];
        }
        req.query = query;
        if (!['GET', 'HEAD'].includes(input.method)) {
          const limit = 2_200_000;
          const length = input.headers.get('content-length');
          if (length && Number(length) > limit)
            throw Object.assign(new Error('BODY_TOO_LARGE'), { statusCode: 413 });
          const reader = input.body?.getReader();
          const chunks: Uint8Array[] = [];
          let size = 0;
          if (reader)
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                size += value.byteLength;
                if (size > limit) {
                  await reader.cancel();
                  throw Object.assign(new Error('BODY_TOO_LARGE'), { statusCode: 413 });
                }
                chunks.push(value);
              }
            } finally {
              reader.releaseLock();
            }
          if (size) {
            if (!/^application\/json(?:\s*;|$)/i.test(input.headers.get('content-type') ?? ''))
              throw Object.assign(new Error('CONTENT_TYPE'), { statusCode: 415 });
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {
              bytes.set(chunk, offset);
              offset += chunk.length;
            }
            try {
              req.body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
            } catch {
              throw Object.assign(new Error('INVALID_JSON'), { statusCode: 400 });
            }
          }
        }
        const value = await (found?.handler ?? notFound!)(req, respond);
        if (!reply.sent) reply.send(value);
      } catch (e) {
        if (!errorHandler) throw e;
        await errorHandler(e instanceof Error ? e : new Error('INTERNAL_ERROR'), req, respond);
      }
      return reply.response(input.method === 'HEAD');
    },
    // Single audited structural boundary; business code's Fastify types do not enter the runtime.
    registration() {
      return api as unknown as FastifyInstance;
    },
  };
  return api;
}
