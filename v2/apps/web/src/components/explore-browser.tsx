'use client';
import { useState, useEffect } from 'react';
import { PersonaList } from '@pv/shared';
import { createClient } from '@pv/api-client';
import { PersonaCard } from './persona-card';
import type { z } from 'zod';
export function ExploreBrowser({
  initial,
  categories,
}: {
  initial: z.infer<typeof PersonaList>;
  categories: string[];
}) {
  const [query, setQuery] = useState(''),
    [category, setCategory] = useState('全部'),
    [page, setPage] = useState(1),
    [data, setData] = useState(initial),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      void createClient()
        .personas(
          '?' +
            new URLSearchParams({
              q: query,
              page: String(page),
              ...(category === '全部' ? {} : { category }),
            }),
        )
        .then((r) => {
          if (live) {
            setData(r);
            setError('');
          }
        })
        .catch(() => {
          if (live) setError('搜索服务暂时不可用，请重试。');
        });
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, category, page]);
  return (
    <>
      <div className="search-box">
        <span>⌕</span>
        <input
          aria-label="搜索人格"
          placeholder="搜索人格、关键词…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
        <span className="muted">探索你的好奇心</span>
      </div>
      <div className="filters">
        {['全部', ...categories].map((c) => (
          <button
            key={c}
            aria-pressed={c === category}
            onClick={() => {
              setCategory(c);
              setPage(1);
            }}
          >
            {c}
          </button>
        ))}
        <span className="result-count">{data.total} 个人格</span>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="persona-grid">
        {data.items.map((p, i) => (
          <PersonaCard key={p.id} persona={p} index={i} />
        ))}
      </div>
      {!data.items.length && (
        <div className="empty">
          <h2>暂时没有匹配结果</h2>
          <button
            className="button"
            onClick={() => {
              setQuery('');
              setCategory('全部');
              setPage(1);
            }}
          >
            重置筛选
          </button>
        </div>
      )}
      {data.total > data.limit && (
        <div className="admin-actions">
          <button className="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            上一页
          </button>
          <span>第 {page} 页</span>
          <button
            className="button"
            disabled={page * data.limit >= data.total}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </button>
        </div>
      )}
    </>
  );
}
