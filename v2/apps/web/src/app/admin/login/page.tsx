import Link from 'next/link';
export const metadata = { title: '管理员登录', robots: { index: false, follow: false } };
export default function Page() {
  return (
    <section className="auth-page">
      <div className="auth-card">
        <p className="eyebrow">ADMINISTRATOR ACCESS</p>
        <h1>管理工作空间</h1>
        <p>真实管理员认证尚未实现。此阶段不接受凭据，也不会创建管理员会话。</p>
        <div className="auth-status">
          <span>◌</span>
          <div>
            <strong>入口已建立，权限保持关闭</strong>
            <small>登录接口返回 AUTH_NOT_IMPLEMENTED</small>
          </div>
        </div>
        <label>
          管理员邮箱
          <input type="email" disabled placeholder="认证服务尚未接入" />
        </label>
        <label>
          密码
          <input type="password" disabled placeholder="暂不可用" />
        </label>
        <button className="button primary" disabled>
          登录服务尚未实现
        </button>
        <Link className="text-link" href="/">
          ← 返回公开首页
        </Link>
      </div>
    </section>
  );
}
