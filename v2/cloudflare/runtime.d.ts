// Minimal declarations for the experimental host boundary; generated OpenNext JS is checked by its own build.
declare module 'cloudflare:node' {
  export function httpServerHandler(server: import('node:http').Server): {
    fetch(request: Request): Promise<Response>;
  };
}
declare module '*worker.js' {
  const worker: {
    fetch(request: Request, env: Record<string, unknown>, ctx: unknown): Promise<Response>;
  };
  export default worker;
}
