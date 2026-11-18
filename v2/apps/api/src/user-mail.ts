// Local simulation contract only: there is no network transport, SMTP client or paid service here.
export type LocalMail = {
  to: string;
  purpose: 'verify' | 'reset';
  token: string;
};
export interface MailSender {
  send(message: LocalMail): Promise<void>;
}
// Deliberately injectable and private to the caller. Never expose this sink through a public API.
export class MemoryMailSink implements MailSender {
  readonly messages: LocalMail[] = [];
  async send(message: LocalMail) {
    if (this.messages.length >= 1000) throw new Error('LOCAL_MAIL_CAPACITY');
    this.messages.push({ ...message });
  }
  take(to: string, purpose: LocalMail['purpose']) {
    const index = this.messages.findIndex(
      (message) => message.to === to && message.purpose === purpose,
    );
    return index < 0 ? undefined : this.messages.splice(index, 1)[0];
  }
  clear() {
    this.messages.splice(0);
  }
}
