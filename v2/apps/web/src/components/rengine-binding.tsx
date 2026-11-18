'use client';
import { useEffect, useState } from 'react';
export function RengineBinding() {
  const [enabled, setEnabled] = useState(false),
    [bound, setBound] = useState(false),
    [password, setPassword] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void fetch('/api/v1/auth/rengine', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => {
        setEnabled(v?.enabled === true);
        setBound(v?.identities?.some((x: { status: string }) => x.status === 'active') === true);
      })
      .catch(() => setEnabled(false));
  }, []);
  if (!enabled) return null;
  return (
    <section className="admin-panel">
      <h2>热土身份绑定 · MOCK</h2>
      <p>仅限已验证的本站账号。不会合并邮箱或转移聊天记录。</p>
      {bound ? (
        <p role="status">热土身份已绑定（模拟验证）。</p>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            setMessage('');
            try {
              const s = await fetch('/api/v1/auth/session', { cache: 'no-store' });
              if (!s.ok) throw new Error();
              const session = await s.json();
              const r = await fetch('/api/v1/auth/rengine/start', {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken },
                body: JSON.stringify({ password }),
              });
              setPassword('');
              if (!r.ok) throw new Error();
              const data = await r.json();
              const url = new URL(data.url, location.origin);
              if (url.origin !== location.origin || url.pathname !== '/auth/rengine/callback')
                throw new Error();
              location.assign(url.href);
            } catch {
              setMessage('绑定未开始，请检查密码或重新登录。');
              setBusy(false);
            }
          }}
        >
          <label>
            确认当前密码
            <input
              aria-label="绑定热土确认密码"
              type="password"
              autoComplete="current-password"
              required
              maxLength={256}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="button" disabled={busy}>
            开始模拟热土绑定
          </button>
        </form>
      )}
      {message && <p role="alert">{message}</p>}
    </section>
  );
}
export function RengineCallback() {
  const [message, setMessage] = useState('正在验证一次性授权…');
  useEffect(() => {
    let live = true;
    const p = new URLSearchParams(location.search);
    const state = p.getAll('state'),
      code = p.getAll('v'),
      type = p.getAll('type');
    history.replaceState(null, '', location.pathname);
    if (state.length !== 1 || code.length !== 1 || type.length !== 1 || type[0] !== 'code') {
      setMessage('授权参数无效，请返回个人中心重新发起。');
      return;
    }
    void (async () => {
      try {
        const s = await fetch('/api/v1/auth/session', { cache: 'no-store' });
        if (!s.ok) throw new Error();
        const session = await s.json();
        const r = await fetch('/api/v1/auth/rengine/finalize', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken },
          body: JSON.stringify({ state: state[0], code: code[0] }),
        });
        if (!r.ok) throw new Error();
        if (live) setMessage('热土身份已绑定（模拟验证）。');
      } catch {
        if (live) setMessage('授权未完成或已过期，请返回个人中心重新发起。');
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  return (
    <section className="page section">
      <h1>热土身份绑定 · MOCK</h1>
      <p role="status">{message}</p>
      <a className="button" href="/account">
        返回个人中心
      </a>
    </section>
  );
}
