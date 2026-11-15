'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createUserClient, UserApiError, type PersonalHistoryList } from '@pv/api-client';
const api = createUserClient();
export function PersonalHistory() {
  const [page, setPage] = useState(1),
    [rows, setRows] = useState<PersonalHistoryList | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setBusy(true);
    setError('');
    void api
      .historyList(page)
      .then((data) => {
        if (live) setRows(data);
      })
      .catch((e) => {
        if (live) {
          if (e instanceof UserApiError && e.status === 401) {
            window.location.assign('/login?next=%2Fhistory');
            return;
          }
          setError(e instanceof Error ? e.message : '聊天记录暂时无法加载。');
        }
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [page]);
  return (
    <section className="page section account-shell">
      <p className="eyebrow">YOUR UNIVERSE / HISTORY</p>
      <h1>每段对话，都有来处。</h1>
      <p className="page-description">
        记录与账户关联。退出或更换设备后，登录同一个已验证账户即可恢复。
      </p>
      <div className="account-links">
        <Link href="/explore" className="button">
          开启新的对话 ↗
        </Link>
        <Link href="/account" className="text-link">
          个人中心
        </Link>
      </div>
      {error && (
        <p role="alert" className="admin-error">
          {error}
        </p>
      )}
      {busy && (
        <p role="status" className="notice">
          正在读取个人记录…
        </p>
      )}
      <div className="personal-history-list">
        {rows?.items.map((row) => (
          <article key={row.id}>
            <Link className="history-entry" href={'/history/' + row.id}>
              <span>
                <strong>{row.personaName}</strong>
                <small>
                  {new Date(row.updatedAt).toLocaleString('zh-CN')} ·{' '}
                  {row.status === 'active' ? '会话已保存' : '已关闭'}
                </small>
              </span>
              <span aria-hidden="true">↗</span>
            </Link>
          </article>
        ))}
      </div>
      {!busy && !error && !rows?.items.length && (
        <div className="empty">
          <span>✧</span>
          <h2>这里会留下你的相遇。</h2>
          <p>选择一个人格，登录后开始新的对话。</p>
          <Link href="/explore" className="text-link">
            前往人格广场 ↗
          </Link>
        </div>
      )}
      {rows && rows.total > rows.limit && (
        <nav className="pagination" aria-label="聊天记录分页">
          <button
            className="button"
            disabled={busy || page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            上一页
          </button>
          <span>
            第 {rows.page} 页 · 共 {rows.total} 段
          </span>
          <button
            className="button"
            disabled={busy || page * rows.limit >= rows.total}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </button>
        </nav>
      )}
    </section>
  );
}
