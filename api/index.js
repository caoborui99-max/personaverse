import {requestOrigin} from '../server/deployment.js';
import { handleApi } from '../server/handler.js';
export default async function handler(req, res) {
  try {
    const origin = requestOrigin(req,process.env);
    const url = new URL(req.url, origin);
    if (url.searchParams.has('route')) {
      const route = url.searchParams.get('route');
      url.searchParams.delete('route');
      url.pathname = '/api/' + route.replace(/^\/+/, '');
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) value.forEach(v => headers.append(key, v));
      else if (value !== undefined) headers.set(key, value);
    }
    let body;
    if (!['GET', 'HEAD'].includes(req.method)) {
      if (req.body !== undefined) {
        body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        if (Buffer.byteLength(body) > 65536) throw Object.assign(new Error('Too large'), { status: 413 });
      } else {
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 65536) throw Object.assign(new Error('Too large'), { status: 413 });
          chunks.push(chunk);
        }
        body = Buffer.concat(chunks);
      }
    }
    const request = new Request(url, { method: req.method, headers, body });
    const response = await handleApi(request, process.env, { identityProvider: 'local' });
    res.statusCode = response.status;
    for (const [key, value] of response.headers) if (key !== 'set-cookie') res.setHeader(key, value);
    const cookies = response.headers.getSetCookie?.() || [];
    if (cookies.length) res.setHeader('Set-Cookie', cookies);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    const status = Number.isInteger(error?.status)&&error.status>=400&&error.status<=599?error.status:500;
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: { code: status===413?'BODY_TOO_LARGE':(error?.code||'SERVER_ERROR'), message: status === 413 ? '请求内容过长。' : '服务器暂时无法完成请求，请稍后重试。' } }));
  }
}

