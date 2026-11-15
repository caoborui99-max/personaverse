import { createConnection } from 'node:net';
// This is a loopback-only development mail bridge. It has no SMTP or external mail capability.
export async function deliverLocalMail(endpoint: string, capability: string, message: unknown) {
  const url = new URL(endpoint);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.pathname !== '/deliver' ||
    url.search ||
    url.username ||
    url.password ||
    !/^\d+$/.test(url.port) ||
    !/^[a-f0-9]{64}$/.test(capability)
  )
    throw new Error('LOCAL_MAIL_ONLY');
  const body = JSON.stringify(message);
  if (Buffer.byteLength(body) > 4096) throw new Error('LOCAL_MAIL_LIMIT');
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: Number(url.port) });
    let response = '',
      settled = false;
    const done = (error?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.setTimeout(5000, () => done(new Error('LOCAL_MAIL_TIMEOUT')));
    socket.once('error', () => done(new Error('LOCAL_MAIL_UNAVAILABLE')));
    socket.on('data', (chunk) => {
      response += chunk.toString('ascii');
      if (response.length > 8192) return done(new Error('LOCAL_MAIL_RESPONSE_LIMIT'));
      const end = response.indexOf('\r\n');
      if (end >= 0)
        done(
          /^HTTP\/1\.[01] 204(?: |$)/.test(response.slice(0, end))
            ? undefined
            : new Error('LOCAL_MAIL_FAILED'),
        );
    });
    socket.once('end', () => {
      if (!settled) done(new Error('LOCAL_MAIL_INCOMPLETE'));
    });
    socket.once('connect', () =>
      socket.write(
        `POST /deliver HTTP/1.1\r\nHost: 127.0.0.1:${url.port}\r\nAuthorization: Bearer ${capability}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
      ),
    );
  });
}
