import Link from 'next/link';
export const metadata = { title: '预置演示 · PersonaVerse' };
export default function Demo() {
  return (
    <section className="section">
      <p className="eyebrow">PRESET DEMO</p>
      <h1>先体验一段预置演示。</h1>
      <p className="notice">
        这是固定展示内容，不代表任何正式人格，不调用AI、不建立聊天会话，也不会扣除额度。
      </p>
      <div className="message user">
        <span className="message-label">演示提问</span>
        <p>我可以在这里做什么？</p>
      </div>
      <div className="message assistant">
        <span className="message-label">预置展示 · 非AI回复</span>
        <p>
          你可以浏览站长发布的人格。注册并验证邮箱后，可使用每天60分钟的个人聊天额度；当前所有对话仍为Mock。
        </p>
      </div>
      <div className="account-links">
        <Link href="/register">注册并验证邮箱 ↗</Link>
        <Link href="/login">登录账户 ↗</Link>
        <Link href="/explore">继续浏览人格 ↗</Link>
      </div>
    </section>
  );
}
