'use client';
import { useEffect, useState } from 'react';
import { Persona, type Persona as PersonaType } from '@pv/shared';
import { PersonaCard } from './persona-card';
const KEY = 'pv:v2:favorites';
function read(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(value)
      ? value.filter((s): s is string => typeof s === 'string' && /^[a-z0-9-]{1,80}$/.test(s))
      : [];
  } catch {
    return [];
  }
}
let memory: string[] = [];
export function FavoriteButton({ slug }: { slug: string }) {
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const sync = () => setSaved(read().includes(slug) || memory.includes(slug));
    sync();
    window.addEventListener('pv-favorites', sync);
    return () => window.removeEventListener('pv-favorites', sync);
  }, [slug]);
  return (
    <button
      className={'favorite ' + (saved ? 'selected' : '')}
      aria-label={(saved ? '取消收藏' : '收藏') + slug}
      aria-pressed={saved}
      onClick={() => {
        const all = [...new Set([...read(), ...memory])];
        memory = saved ? all.filter((s) => s !== slug) : [...all, slug];
        try {
          localStorage.setItem(KEY, JSON.stringify(memory));
        } catch {}
        window.dispatchEvent(new Event('pv-favorites'));
      }}
    >
      {saved ? '♥' : '♡'}
    </button>
  );
}
export function Favorites() {
  const [slugs, setSlugs] = useState<string[]>([]);
  const [items, setItems] = useState<PersonaType[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const sync = () => setSlugs([...new Set([...read(), ...memory])]);
    sync();
    window.addEventListener('pv-favorites', sync);
    return () => window.removeEventListener('pv-favorites', sync);
  }, []);
  useEffect(() => {
    let live = true;
    setError('');
    void Promise.all(
      slugs.map(async (slug) => {
        const res = await fetch('/api/v1/personas/' + encodeURIComponent(slug), {
          cache: 'no-store',
        });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error('收藏资料暂时无法加载。');
        return Persona.parse((await res.json()).persona);
      }),
    )
      .then((rows) => {
        if (live) setItems(rows.filter((p): p is PersonaType => p !== null));
      })
      .catch((e) => {
        if (live) setError(e instanceof Error ? e.message : '加载失败');
      });
    return () => {
      live = false;
    };
  }, [slugs]);
  return (
    <>
      {error && <p role="alert">{error}</p>}
      <div className="persona-grid">
        {items.map((p, i) => (
          <PersonaCard key={p.slug} persona={p} index={i} />
        ))}
      </div>
      {!slugs.length && (
        <div className="empty">
          <span>♡</span>
          <h2>留一个位置，给新的相遇</h2>
          <p>在探索中收藏感兴趣的人格。收藏仅保存在当前设备。</p>
        </div>
      )}
    </>
  );
}
