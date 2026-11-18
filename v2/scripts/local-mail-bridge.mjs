import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
// Local simulated delivery only, not SMTP. No HTTP retrieval route; test code holds the sink reference.
export async function localMailBridge(options = {}) {
  const capability = randomBytes(32).toString('hex');
  const messages = [];
  const server = createServer(async (req, res) => {
    const supplied = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
    if (
      req.method !== 'POST' ||
      req.url !== '/deliver' ||
      !/^[a-f0-9]{64}$/.test(supplied) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(capability))
    ) {
      res.writeHead(403).end();
      return;
    }
    try {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (Buffer.byteLength(raw) > 4096) throw new Error('BODY_LIMIT');
      }
      const value = JSON.parse(raw);
      if (
        !value ||
        !['verify', 'reset'].includes(value.purpose) ||
        typeof value.to !== 'string' ||
        value.to.length > 254 ||
        !/^\S+@\S+$/.test(value.to) ||
        !/^[a-f0-9]{64}$/.test(value.token)
      )
        throw new Error('INVALID_LOCAL_MAIL');
      if (messages.length >= 1000) throw new Error('LOCAL_MAIL_CAPACITY');
      messages.push({ to: value.to, purpose: value.purpose, token: value.token });
      if (options.directory) {
        await mkdir(options.directory, { recursive: true, mode: 0o700 });
        const link =
          (options.origin ?? 'http://127.0.0.1:4320') +
          (value.purpose === 'verify' ? '/verify-email' : '/reset-password') +
          '#token=' +
          value.token;
        await writeFile(
          options.directory + '/' + randomUUID() + '.json',
          JSON.stringify({ ...value, link, simulated: true }),
          { mode: 0o600 },
        );
      }
      res.writeHead(204).end();
    } catch {
      res.writeHead(503).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    url: 'http://127.0.0.1:' + address.port + '/deliver',
    capability,
    messages,
    close: () => new Promise((r) => server.close(r)),
  };
}
