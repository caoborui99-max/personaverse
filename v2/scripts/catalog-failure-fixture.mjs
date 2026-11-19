// Loopback-only synthetic upstream for browser regression. Never imported by production.
import { createServer } from 'node:http';
let mode = 'offline';
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:4311');
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  if (url.pathname === '/__test/mode' && req.method === 'POST') {
    mode = url.searchParams.get('value') ?? 'offline';
    res.end('{}');
    return;
  }
  if (url.pathname === '/ready') {
    res.end('{}');
    return;
  }
  if (
    mode === 'offline' ||
    (mode === 'categories-offline' && url.pathname === '/api/v1/categories')
  ) {
    res.statusCode = 503;
    res.end(JSON.stringify({ error: { code: 'SYNTHETIC_OUTAGE' } }));
    return;
  }
  if (url.pathname === '/api/v1/personas') {
    res.end(
      JSON.stringify({
        mode: 'database',
        items:
          mode === 'empty'
            ? []
            : [
                {
                  id: '00000000-0000-4000-8000-000000000001',
                  slug: 'synthetic-persona',
                  name: 'TEST ONLY 人格',
                  category: 'TEST ONLY',
                  summary: '合成回归数据',
                  background: 'TEST ONLY',
                  mock: false,
                  tags: [],
                },
              ],
        total: mode === 'empty' ? 0 : 1,
        page: 1,
        limit: 12,
      }),
    );
    return;
  }
  if (url.pathname === '/api/v1/categories') {
    res.end(JSON.stringify({ items: ['TEST ONLY'] }));
    return;
  }
  res.statusCode = 404;
  res.end('{}');
});
server.listen(4311, '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => server.close(() => process.exit(0)));
