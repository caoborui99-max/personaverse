'use client';
import { useEffect, useRef, useState } from 'react';
import { createUserClient, UserApiError } from '@pv/api-client';
import type { Persona } from '@pv/shared';
import Link from 'next/link';
import { PersonaCard } from './persona-card';
const api = createUserClient();
function login() {
  window.location.assign(
    '/login?next=' + encodeURIComponent(window.location.pathname + window.location.search),
  );
}
export function AccountFavoriteButton({ slug }: { slug: string }) {
  const generation = useRef(0);
  const [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(true),
    [guest, setGuest] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const sync = () => {
      const current = ++generation.current;
      setSaved(false);
      setBusy(true);
      void api
        .favorite(slug)
        .then((v) => {
          if (live && current === generation.current) {
            setSaved(v.saved);
            setGuest(false);
          }
        })
        .catch((e) => {
          if (
            live &&
            current === generation.current &&
            e instanceof UserApiError &&
            e.status === 401
          ) {
            setGuest(true);
            setSaved(false);
          }
        })
        .finally(() => {
          if (live && current === generation.current) setBusy(false);
        });
    };
    sync();
    const hide = () => {
      generation.current++;
      setSaved(false);
      setBusy(true);
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') hide();
      else sync();
    };
    const channel =
      typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('pv-user-session');
    if (channel) channel.onmessage = sync;
    window.addEventListener('focus', sync);
    window.addEventListener('pageshow', sync);
    window.addEventListener('pagehide', hide);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pv-user-favorites', sync);
    return () => {
      live = false;
      generation.current++;
      window.removeEventListener('pv-user-favorites', sync);
      channel?.close();
      window.removeEventListener('focus', sync);
      window.removeEventListener('pageshow', sync);
      window.removeEventListener('pagehide', hide);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [slug]);
  return (
    <span className="favorite-control">
      <button
        className={'favorite ' + (saved ? 'selected' : '')}
        aria-label={(saved ? '取消收藏' : '收藏') + slug}
        aria-pressed={saved}
        disabled={busy}
        onClick={async () => {
          if (guest) {
            login();
            return;
          }
          if (busy) return;
          setBusy(true);
          const current = ++generation.current;
          setError('');
          try {
            await api.setFavorite(slug, !saved);
            if (current !== generation.current) return;
            setSaved(!saved);
            window.dispatchEvent(new Event('pv-user-favorites'));
          } catch (e) {
            if (current !== generation.current) return;
            if (e instanceof UserApiError && e.status === 401) {
              login();
              return;
            }
            setError(e instanceof Error ? e.message : '收藏未保存，请重试。');
          } finally {
            if (current === generation.current) setBusy(false);
          }
        }}
      >
        {saved ? '♥' : '♡'}
      </button>
      {error && (
        <span className="favorite-feedback" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
export function AccountFavorites() {
  const [items, setItems] = useState<Persona[]>([]),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [limit, setLimit] = useState(20),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [guest, setGuest] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const update = () => setRevision((n) => n + 1);
    window.addEventListener('pv-user-favorites', update);
    return () => window.removeEventListener('pv-user-favorites', update);
  }, []);
  useEffect(() => {
    let live = true;
    setBusy(true);
    setError('');
    void api
      .favorites(page)
      .then((data) => {
        if (live) {
          setItems(data.items);
          setTotal(data.total);
          setLimit(data.limit);
          setGuest(false);
        }
      })
      .catch((e) => {
        if (live) {
          if (e instanceof UserApiError && e.status === 401) {
            setGuest(true);
            setItems([]);
          } else setError(e instanceof Error ? e.message : '收藏暂时无法加载。');
        }
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [page, revision]);
  if (guest)
    return (
      <div className="empty">
        <span>♡</span>
        <h2>把相遇留在你的账户中。</h2>
        <p>登录后收藏会保存在账户中，可跨设备恢复。</p>
        <Link className="button" href="/login?next=%2Ffavorites">
          登录后查看收藏 ↗
        </Link>
      </div>
    );
  return (
    <>
      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      {busy && (
        <p role="status" className="notice">
          正在读取收藏…
        </p>
      )}
      <div className="persona-grid">
        {items.map((p, i) => (
          <PersonaCard key={p.slug} persona={p} index={i} />
        ))}
      </div>
      {!busy && !error && !items.length && (
        <div className="empty">
          <span>♡</span>
          <h2>留一个位置，给新的相遇。</h2>
          <p>探索并收藏感兴趣的人格。已下架的人格不会公开显示。</p>
          <Link href="/explore" className="text-link">
            前往人格广场 ↗
          </Link>
        </div>
      )}
      {total > limit && (
        <nav className="pagination" aria-label="收藏分页">
          <button
            className="button"
            disabled={busy || page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            上一页
          </button>
          <span>第 {page} 页</span>
          <button
            className="button"
            disabled={busy || page * limit >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </button>
        </nav>
      )}
    </>
  );
}
