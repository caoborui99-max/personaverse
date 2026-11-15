'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createUserClient } from '@pv/api-client';
import { announceUserSessionChange } from './user-boundary';
const api = createUserClient();
type Mode = 'login' | 'register' | 'forgot' | 'verify' | 'reset';
export function safeUserDestination(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\'))
    return '/account';
  const url = new URL(value, window.location.origin);
  if (
    url.origin !== window.location.origin ||
    /^\/(?:admin|login|register|verify-email|reset-password|forgot-password)(?:\/|$)/.test(
      url.pathname,
    )
  )
    return '/account';
  return url.pathname + url.search;
}
export function UserAuthForm({ mode }: { mode: Mode }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [complete, setComplete] = useState(false);
  useEffect(() => {
    if (mode !== 'verify' && mode !== 'reset') return;
    // Fragment secrets never reach the server URL, referrer or a browser storage API.
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    setToken(fragment.get('token') ?? '');
    if (window.location.hash || window.location.search)
      window.history.replaceState(null, '', window.location.pathname);
  }, [mode]);
  const titles: Record<Mode, string> = {
    login: '回到你的宇宙。',
    register: '让每次相遇，有处延续。',
    forgot: '找回你的账户。',
    verify: '验证你的邮箱。',
    reset: '设置新的密码。',
  };
  return (
    <section className="auth-page">
      <div className="auth-card user-auth">
        <p className="eyebrow">PERSONAVERSE / YOUR ACCOUNT</p>
        <h1>{titles[mode]}</h1>
        <p>
          {mode === 'login'
            ? '使用普通用户账户登录，继续你的个人对话。管理员身份与此独立。'
            : mode === 'register'
              ? '验证邮箱后登录，聊天记录与收藏将保存在你的账户中。'
              : mode === 'forgot'
                ? '如果邮箱符合条件，系统会安排密码重置通知。'
                : '请使用验证通知中的一次性链接。令牌过期或已使用时需要重新申请。'}
        </p>
        {['register', 'forgot'].includes(mode) && (
          <p className="notice mail-mode">当前仅启用本地模拟邮件，不会向邮箱发送真实邮件。</p>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy || complete) return;
            setBusy(true);
            setError('');
            setNotice('');
            try {
              if (mode === 'login') {
                await api.login(email, password);
                announceUserSessionChange();
                setPassword('');
                const next = new URLSearchParams(window.location.search).get('next');
                window.location.assign(safeUserDestination(next));
              } else if (mode === 'register') {
                await api.register(email, password, displayName);
                setPassword('');
                setComplete(true);
                setNotice(
                  '如果邮箱符合注册条件，系统会安排验证通知。本地模拟环境不会发送真实邮件。',
                );
              } else if (mode === 'forgot') {
                await api.forgot(email);
                setComplete(true);
                setNotice('如果邮箱符合条件，系统会安排重置通知。本地模拟环境不会发送真实邮件。');
              } else if (mode === 'verify') {
                if (!token) {
                  await api.resend(email);
                  setNotice('如果邮箱符合条件，系统会安排验证通知。本地模拟环境不会发送真实邮件。');
                  return;
                }
                await api.verify(token);
                setToken('');
                setComplete(true);
                setNotice('邮箱已通过服务端验证，现在可以登录。');
              } else {
                await api.reset(token, password);
                setPassword('');
                setToken('');
                setComplete(true);
                setNotice('密码已更新，旧登录会话已撤销。请使用新密码重新登录。');
              }
            } catch (e) {
              setError(e instanceof Error ? e.message : '请求失败，请稍后重试。');
            } finally {
              setBusy(false);
            }
          }}
        >
          {(['login', 'register', 'forgot'].includes(mode) ||
            (mode === 'verify' && !token && !complete)) && (
            <label>
              邮箱
              <input
                type="email"
                required
                autoComplete="username"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={254}
                value={email}
                disabled={busy || complete}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          )}
          {mode === 'register' && (
            <label>
              显示名称
              <input
                autoComplete="nickname"
                maxLength={80}
                value={displayName}
                disabled={busy || complete}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </label>
          )}
          {['login', 'register', 'reset'].includes(mode) && (
            <label>
              {mode === 'reset' ? '新密码' : '密码'}
              <input
                type="password"
                required
                minLength={mode === 'login' ? 1 : 12}
                maxLength={256}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                disabled={busy || complete}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}
          {['register', 'reset'].includes(mode) && (
            <p className="form-hint">密码至少 12 个字符；空格和大小写会原样保留。</p>
          )}
          {['verify', 'reset'].includes(mode) && !token && !complete && (
            <p className="notice">
              请打开包含验证信息的完整链接。验证链接使用后或过期后，可重新申请通知。
            </p>
          )}
          {error && (
            <p className="admin-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
          {!complete && (
            <button
              className="button primary"
              type="submit"
              disabled={busy || (mode === 'reset' && !token)}
            >
              {busy
                ? '正在安全验证…'
                : mode === 'login'
                  ? '登录'
                  : mode === 'register'
                    ? '创建账户'
                    : mode === 'forgot'
                      ? '申请重置密码'
                      : mode === 'verify'
                        ? '验证邮箱'
                        : '更新密码'}
            </button>
          )}
        </form>
        <nav className="auth-links" aria-label="账户操作">
          {mode !== 'login' && <Link href="/login">返回登录 ↗</Link>}
          {mode === 'login' && (
            <>
              <Link href="/register">创建账户</Link>
              <Link href="/forgot-password">忘记密码？</Link>
            </>
          )}
          {mode === 'verify' && !complete && <Link href="/register">重新注册或申请验证</Link>}
          <Link href="/explore">继续浏览人格广场</Link>
        </nav>
      </div>
    </section>
  );
}
