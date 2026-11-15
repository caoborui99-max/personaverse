import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { MailSender, LocalMail } from './user-mail.ts';
export function localFileMail(environment: string): MailSender {
  if (!['test', 'development'].includes(environment)) throw new Error('LOCAL_MAIL_ONLY');
  const directory = resolve(process.env.PV_LOCAL_MAIL_DIR ?? resolve(process.cwd(), '.local-mail'));
  return {
    async send(message: LocalMail) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const link =
        (process.env.WEB_ORIGIN ?? 'http://127.0.0.1:4310') +
        (message.purpose === 'verify' ? '/verify-email' : '/reset-password') +
        '#token=' +
        message.token;
      await writeFile(
        resolve(directory, randomUUID() + '.json'),
        JSON.stringify({ ...message, link, simulated: true }),
        { mode: 0o600 },
      );
    },
  };
}
