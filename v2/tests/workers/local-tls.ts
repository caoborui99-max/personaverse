import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

// Test CA and keys remain in an ignored private directory. No OS/shared trust
// store is modified; only the disposable Firefox profile trusts this test CA.
export function localTls() {
  const root = resolve('.local-preview/cloudflare-validation');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const directory = mkdtempSync(join(root, 'tls-'));
  const key = join(directory, 'server.key');
  const cert = join(directory, 'server.pem');
  const ca = join(directory, 'ca.pem');
  const run = (binary: string, args: string[]) => {
    const r = spawnSync(binary, args, { cwd: directory, stdio: 'pipe' });
    if (r.status !== 0) throw new Error(`Local TLS setup failed: ${binary}`);
  };
  writeFileSync(
    join(directory, 'server.ext'),
    'subjectAltName=IP:127.0.0.1,DNS:localhost\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n',
  );
  run('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '2',
    '-subj',
    '/CN=PersonaVerse LOCAL TEST CA',
    '-keyout',
    'ca.key',
    '-out',
    ca,
  ]);
  run('openssl', [
    'req',
    '-new',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-subj',
    '/CN=localhost',
    '-keyout',
    key,
    '-out',
    'server.csr',
  ]);
  run('openssl', [
    'x509',
    '-req',
    '-in',
    'server.csr',
    '-CA',
    ca,
    '-CAkey',
    'ca.key',
    '-CAcreateserial',
    '-days',
    '2',
    '-extfile',
    'server.ext',
    '-out',
    cert,
  ]);
  const profile = () => {
    const path = mkdtempSync(join(directory, 'firefox-'));
    run('certutil', ['-N', '-d', 'sql:' + path, '--empty-password']);
    run('certutil', [
      '-A',
      '-d',
      'sql:' + path,
      '-n',
      'PersonaVerse LOCAL TEST CA',
      '-t',
      'C,,',
      '-i',
      ca,
    ]);
    return path;
  };
  return { directory, key, cert, ca, profile };
}
