'use client';
import { useEffect, useState } from 'react';
import { fixtures } from '@pv/shared';
import { PersonaCard } from './persona-card';
const KEY = 'pv:v2:favorites';
function read(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(value)
      ? value.filter(
          (s): s is string => typeof s === 'string' && fixtures.some((p) => p.slug === s),
        )
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
  useEffect(() => {
    const sync = () => setSlugs([...new Set([...read(), ...memory])]);
    sync();
    window.addEventListener('pv-favorites', sync);
    return () => window.removeEventListener('pv-favorites', sync);
  }, []);
  return (
    <>
      <div className="persona-grid">
        {fixtures
          .filter((p) => slugs.includes(p.slug))
          .map((p, i) => (
            <PersonaCard key={p.slug} persona={p} index={i} />
          ))}
      </div>
      {!slugs.length && (
        <div className="empty">
          <span>♡</span>
          <h2>留一个位置，给新的相遇</h2>
          <p>在探索中收藏感兴趣的测试人格。收藏仅保存在当前设备。</p>
        </div>
      )}
    </>
  );
}
