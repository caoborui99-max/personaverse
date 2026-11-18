'use client';
import { useState } from 'react';
import { createAdminClient } from '@pv/api-client';
export function AdminLogin() {
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError('');
        try {
          await createAdminClient().login(email, password);
          window.location.assign('/admin');
        } catch (e) {
          setError(e instanceof Error ? e.message : '登录失败。');
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="notice">登录后将再次向服务端确认实际会话。</p>
      <label>
        管理员邮箱
        <input
          required
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
        />
      </label>
      <label>
        密码
        <input
          required
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />
      </label>
      {error && (
        <p role="alert" className="admin-error">
          {error}
        </p>
      )}
      <button className="button primary" type="submit" disabled={busy}>
        {busy ? '验证会话中…' : '登录'}
      </button>
    </form>
  );
}
