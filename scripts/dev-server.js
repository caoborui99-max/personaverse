import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import api from '../api/index.js';
import { getDatabase, migrateDatabase } from '../server/database.js';
import { initializeData } from '../server/handler.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = await getDatabase(process.env);
await migrateDatabase(db);
await initializeData(db);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const pages = new Set(['/index.html', '/persona.html', '/admin.html', '/chat.html']);
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) return api(req, res);
  let route;
  try { route = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname); }
  catch { res.writeHead(400); return res.end('Bad request'); }
  if (!(pages.has(route) || /^\/(css|js|assets)\//.test(route))) { res.writeHead(404); return res.end('Not found'); }
  const full = path.resolve(root, '.' + route);
  if (!full.startsWith(root + path.sep) || route.includes('\0') || route.includes('..')) { res.writeHead(404); return res.end('Not found'); }
  try {
    const body = await readFile(full);
    res.writeHead(200, { 'Content-Type': mime[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
});
const port = Number(process.env.PORT || 8000);
server.listen(port, '127.0.0.1', () => console.log('PersonaVerse: http://127.0.0.1:' + port));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
