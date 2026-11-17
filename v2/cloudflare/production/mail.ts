import type { MailSender } from '../../apps/api/src/user-mail.ts';
import { productionOrigin } from './policy.ts';
export function productionMail(
  env: { RESEND_API_KEY: string; MAIL_FROM: string; WEB_ORIGIN: string },
  transport: typeof fetch = fetch,
): MailSender {
  return {
    async send(message) {
      if (!env.RESEND_API_KEY || !env.MAIL_FROM || env.MAIL_FROM.includes('REPLACE'))
        throw new Error('MAIL_NOT_CONFIGURED');
      const link = new URL(
        message.purpose === 'verify' ? '/verify-email' : '/reset-password',
        productionOrigin(env.WEB_ORIGIN),
      );
      link.hash = new URLSearchParams({ token: message.token }).toString();
      const response = await transport('https://api.resend.com/emails', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
        headers: {
          authorization: 'Bearer ' + env.RESEND_API_KEY,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: env.MAIL_FROM,
          to: [message.to],
          subject: message.purpose === 'verify' ? 'PersonaVerse 邮箱验证' : 'PersonaVerse 密码重置',
          text: '请在 PersonaVerse 完成操作：' + link.toString(),
        }),
      });
      if (!response.ok) throw new Error('MAIL_DELIVERY_FAILED');
    },
  };
}
