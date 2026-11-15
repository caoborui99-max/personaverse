'use client';
import { useState } from 'react';
import Link from 'next/link';
import { createUserClient, type UserProfile } from '@pv/api-client';
import { prepareUserSessionExit } from './user-boundary';
const api = createUserClient();
export function UserAccount({ initial }: { initial: UserProfile }) {
  const [user, setUser] = useState(initial);
  const [name, setName] = useState(initial.displayName);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  async function action(run: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await run();
    } catch (e) {
      setError(e instanceof Error ? e.message : '请求失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="page section account-shell">
      <p className="eyebrow">YOUR UNIVERSE / ACCOUNT</p>
      <h1>{user.displayName || '你的个人空间'}</h1>
      <p className="page-description">{user.email} · 邮箱已验证</p>
      <nav className="account-links">
        <Link className="button" href="/history">
          我的聊天记录 ↗
        </Link>
        <Link className="button" href="/favorites">
          我的收藏 ↗
        </Link>
        <Link className="text-link" href="/explore">
          探索人格
        </Link>
      </nav>
      {error && (
        <p role="alert" className="admin-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <section className="admin-panel">
        <h2>个人资料</h2>
        <form
          className="admin-form"
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              await api.profile(name);
              const current = await api.session();
              setUser(current.user);
              setName(current.user.displayName);
              setNotice('个人资料已保存。');
            });
          }}
        >
          <label>
            显示名称
            <input
              maxLength={80}
              autoComplete="nickname"
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <p className="form-hint">
            {name !== user.displayName ? '有未保存修改' : '已保存'} · 邮箱不在此处更改。
          </p>
          <button className="button" disabled={busy || name === user.displayName}>
            保存资料
          </button>
        </form>
      </section>
      <section className="admin-panel">
        <h2>登录与安全</h2>
        <p>退出后当前登录会话立即撤销。聊天和收藏保留在账户中，重新登录或更换设备后仍可恢复。</p>
        <div className="account-links">
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                const exit = prepareUserSessionExit('/login');
                try {
                  await api.logout();
                  exit.complete();
                } catch (error) {
                  exit.cancel();
                  throw error;
                }
              })
            }
          >
            退出登录
          </button>
          <Link href="/forgot-password" className="text-link">
            重置密码 ↗
          </Link>
        </div>
      </section>
      <section className="admin-panel privacy-panel">
        <h2>注销账户</h2>
        <p>
          注销会撤销全部登录会话，并删除个人聊天内容、收藏和个人资料。用于必要财务审计的不可变金额记录与不含聊天原文的关联标识将按保留规则单独保存；不会向管理员开放私人对话浏览接口。
        </p>
        {!confirm ? (
          <button className="text-link" disabled={busy} onClick={() => setConfirm(true)}>
            查看注销确认
          </button>
        ) : (
          <form
            className="admin-form"
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                const exit = prepareUserSessionExit('/login?closed=1');
                try {
                  await api.removeAccount(password);
                  setPassword('');
                  exit.complete();
                } catch (error) {
                  exit.cancel();
                  throw error;
                }
              });
            }}
          >
            <label>
              确认当前密码
              <input
                type="password"
                required
                maxLength={256}
                autoComplete="current-password"
                value={password}
                disabled={busy}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <p className="notice">此操作不可撤销。请确认你已不再需要这些个人记录。</p>
            <div className="account-links">
              <button className="button danger-button" disabled={busy || !password}>
                确认注销账户并删除个人记录
              </button>
              <button
                type="button"
                className="text-link"
                disabled={busy}
                onClick={() => {
                  setConfirm(false);
                  setPassword('');
                }}
              >
                取消
              </button>
            </div>
          </form>
        )}
      </section>
    </section>
  );
}
