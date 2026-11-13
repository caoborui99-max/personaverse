'use client';
import { useState } from 'react';
import { fixtures } from '@pv/shared';
import { PersonaCard } from './persona-card';
export function ExploreBrowser() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const results = fixtures.filter(
    (p) => (category === '全部' || p.category === category) && (p.name + p.summary).includes(query),
  );
  return (
    <>
      <div className="search-box">
        <span>⌕</span>
        <input
          aria-label="搜索人格"
          placeholder="搜索人格、关键词…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="muted">探索你的好奇心</span>
      </div>
      <div className="filters">
        {['全部', ...new Set(fixtures.map((p) => p.category))].map((c) => (
          <button key={c} aria-pressed={category === c} onClick={() => setCategory(c)}>
            {c}
          </button>
        ))}
        <span className="result-count">{results.length} 个测试人格</span>
      </div>
      <div className="persona-grid">
        {results.map((p, i) => (
          <PersonaCard key={p.slug} persona={p} index={i} />
        ))}
      </div>
      {!results.length && (
        <div className="empty">
          <h2>暂时没有匹配结果</h2>
          <button
            className="button"
            onClick={() => {
              setQuery('');
              setCategory('全部');
            }}
          >
            重置筛选
          </button>
        </div>
      )}
    </>
  );
}
