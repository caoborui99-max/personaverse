import { PrismaClient } from '@prisma/client';
import { createInterface } from 'node:readline/promises';
import { databaseConfig } from '../apps/api/src/config.ts';
import { Email, Password, passwordHash } from '../apps/api/src/auth.ts';
const config = databaseConfig();
if (config.environment === 'production')
  throw new Error(
    'This phase supports initialization only in an explicitly isolated local database',
  );
if (!process.stdin.isTTY || !process.stdout.isTTY)
  throw new Error(
    'Interactive TTY required; passwords cannot be passed in arguments or environment variables',
  );
const url = new URL(config.databaseUrl);
const reader = createInterface({ input: process.stdin, output: process.stdout });
console.log(
  `Initialize one admin in ${config.environment}: ${url.hostname}${url.pathname}. No personas will be created.`,
);
const confirmation = await reader.question('Type the database name to confirm: ');
if (confirmation !== url.pathname.slice(1)) {
  reader.close();
  throw new Error('Database confirmation mismatch');
}
const email = Email.parse(await reader.question('Admin email: '));
reader.close();
async function hidden(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let value = '';
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      process.stdin.off('data', data);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const data = (chunk: Buffer) => {
      for (const c of chunk.toString()) {
        if (c === '\u0003') {
          cleanup();
          reject(new Error('Cancelled'));
          return;
        }
        if (c === '\r' || c === '\n') {
          cleanup();
          resolve(value);
          return;
        }
        if (c === '\u007f') {
          value = value.slice(0, -1);
        } else if (c >= ' ') {
          value += c;
        }
      }
    };
    process.stdin.on('data', data);
  });
}
const password = Password.parse(await hidden('Password (hidden, 12–256 characters): '));
if (password !== (await hidden('Confirm password (hidden): ')))
  throw new Error('Password mismatch');
const db = new PrismaClient({ datasources: { db: { url: config.databaseUrl } } });
try {
  await db.$transaction(async (tx) => {
    const admin = await tx.adminAccount.create({
      data: { email, passwordHash: await passwordHash(password) },
    });
    await tx.adminAuditLog.create({
      data: {
        adminId: admin.id,
        action: 'initialize-admin',
        objectType: 'authentication',
        requestId: crypto.randomUUID(),
        changeSummary: {},
      },
    });
  });
  console.log('Admin created. Existing accounts are never overwritten.');
} catch {
  throw new Error(
    'Initialization failed; check migration state or whether the account already exists.',
  );
} finally {
  await db.$disconnect();
}
