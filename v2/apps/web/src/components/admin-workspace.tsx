'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createAdminClient } from '@pv/api-client';
import type { AdminPersona, CoreVersion, DraftFields, Message } from '@pv/shared';
const api = createAdminClient();
const text = (e: unknown) => (e instanceof Error ? e.message : '操作失败，请重试。');
export function AdminLogout() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <>
      <button
        className="text-link"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.logout();
            window.location.assign('/admin/login');
          } catch (e) {
            setError(text(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        退出登录
      </button>
      {error && <span role="alert">{error}</span>}
    </>
  );
}
export function AdminPassword() {
  const [current, setCurrent] = useState(''),
    [next, setNext] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <details className="admin-panel">
      <summary>修改密码并撤销所有会话</summary>
      <form
        className="admin-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api.password(current, next);
            window.location.assign('/admin/login');
          } catch (e) {
            setError(text(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          当前密码
          <input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        </label>
        <label>
          新密码（至少 12 字符）
          <input
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={256}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button className="button" disabled={busy}>
          更新密码并重新登录
        </button>
      </form>
    </details>
  );
}
export function AdminNew() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <>
      <h1>创建空白人格草稿</h1>
      <p className="page-description">不会自动填写名称、故事、内核或开场白。内容由站长亲自创作。</p>
      {error && <p role="alert">{error}</p>}
      <button
        className="button primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const p = await api.create();
            window.location.assign(`/admin/personas/${p.id}/edit`);
          } catch (e) {
            setError(text(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? '创建中…' : '创建空白草稿'}
      </button>
    </>
  );
}
export function AdminList() {
  const [items, setItems] = useState<AdminPersona[]>([]),
    [q, setQ] = useState(''),
    [status, setStatus] = useState(''),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [busy, setBusy] = useState(true),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setBusy(true);
    setError('');
    const timer = setTimeout(() => {
      void api
        .list(
          '?' +
            new URLSearchParams({
              q,
              page: String(page),
              limit: '12',
              ...(status ? { status } : {}),
            }),
        )
        .then((r) => {
          if (live) {
            setItems(r.items);
            setTotal(r.total);
          }
        })
        .catch((e) => {
          if (live) setError(text(e));
        })
        .finally(() => {
          if (live) setBusy(false);
        });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, status, page]);
  return (
    <>
      <div className="section-heading">
        <div>
          <p className="eyebrow">PERSONA LIBRARY</p>
          <h1>人格管理</h1>
        </div>
        <Link className="button primary" href="/admin/personas/new">
          新建草稿 ＋
        </Link>
      </div>
      <div className="admin-toolbar">
        <input
          aria-label="搜索管理人格"
          placeholder="搜索名称或 slug"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="人格状态"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">全部状态</option>
          <option value="draft">草稿</option>
          <option value="published">已发布</option>
          <option value="archived">已归档</option>
        </select>
      </div>
      {error && <p role="alert">{error}</p>}
      {busy ? (
        <p role="status">加载数据库资料中…</p>
      ) : (
        <>
          <p className="muted">共 {total} 个人格</p>
          <div className="admin-list">
            {items.map((p) => (
              <article key={p.id}>
                <div>
                  <Link href={`/admin/personas/${p.id}/edit`}>
                    <h2>{p.name || '未命名草稿'}</h2>
                  </Link>
                  <small>{p.slug}</small>
                  <p>
                    {p.status} · 修订 {p.revision}
                    {p.isTest ? ' · 测试数据' : ''}
                  </p>
                </div>
                <div className="admin-actions">
                  <Link href={`/admin/personas/${p.id}/edit`}>编辑 ↗</Link>
                  <Link href={`/admin/personas/${p.id}/versions`}>版本</Link>
                </div>
              </article>
            ))}
          </div>
          {!items.length && <p className="empty">暂无匹配资料。</p>}
          <div className="admin-actions">
            <button className="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              上一页
            </button>
            <span>第 {page} 页</span>
            <button
              className="button"
              disabled={page * 12 >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </button>
          </div>
        </>
      )}
    </>
  );
}
const fieldsOf = (p: AdminPersona): DraftFields => ({
  name: p.name,
  slug: p.slug,
  summary: p.summary,
  background: p.background,
  avatarUrl: p.avatarUrl ?? '',
  tags: p.tags,
  categoryIds: p.categories.map((c) => c.categoryId),
  coreText: p.draftVersion?.coreText ?? '',
  openingMessage: p.draftVersion?.openingMessage ?? '',
});
export function AdminEdit({ id }: { id: string }) {
  const [persona, setPersona] = useState<AdminPersona | null>(null),
    [fields, setFields] = useState<DraftFields | null>(null),
    [categories, setCategories] = useState<{ id: string; name: string; slug: string }[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [dirty, setDirty] = useState(false),
    [catName, setCatName] = useState(''),
    [catSlug, setCatSlug] = useState('');
  useEffect(() => {
    let live = true;
    void Promise.all([api.get(id), api.categories()])
      .then(([p, c]) => {
        if (live) {
          setPersona(p);
          setFields(fieldsOf(p));
          setCategories(c.items);
        }
      })
      .catch((e) => {
        if (live) setError(text(e));
      });
    return () => {
      live = false;
    };
  }, [id]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const update = <K extends keyof DraftFields>(key: K, value: DraftFields[K]) => {
    setFields((f) => (f ? { ...f, [key]: value } : f));
    setDirty(true);
    setNotice('');
  };
  async function action(name: 'publish' | 'unpublish' | 'archive') {
    if (!persona || busy) return;
    setBusy(true);
    setError('');
    try {
      const p = await api.action(id, name, persona.revision);
      setPersona(p);
      setNotice(
        name === 'publish'
          ? '当前草稿版本已发布。'
          : name === 'archive'
            ? '已安全归档，历史内容保留。'
            : '已下架，公开入口已关闭。',
      );
    } catch (e) {
      setError(text(e));
    } finally {
      setBusy(false);
    }
  }
  if (!fields || !persona)
    return (
      <div>
        <h1>人格编辑器</h1>
        <p role={error ? 'alert' : 'status'}>{error || '从数据库加载中…'}</p>
      </div>
    );
  const frozen = busy || persona.status === 'archived';
  return (
    <>
      <div className="section-heading">
        <div>
          <p className="eyebrow">OWNER AUTHORED / VERSIONED</p>
          <h1>{persona.name || '未命名草稿'}</h1>
        </div>
        <Link href={`/admin/personas/${id}/versions`}>版本历史 ↗</Link>
      </div>
      <p className="notice">
        {persona.status} · 数据库修订 {persona.revision} · 草稿版本{' '}
        {persona.draftVersion?.versionNumber ?? '尚无'} ·{' '}
        {dirty ? '有未保存修改' : '当前内容已同步'}
      </p>
      {error && (
        <p role="alert" className="admin-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <form
        className="admin-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError('');
          try {
            const p = await api.save(id, fields, persona.revision);
            setPersona(p);
            setFields(fieldsOf(p));
            setDirty(false);
            setNotice('草稿已保存，并创建不可变的新版本。');
          } catch (e) {
            setError(text(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={frozen}>
          <div className="form-grid">
            <label>
              人格名称
              <input
                value={fields.name}
                maxLength={80}
                onChange={(e) => update('name', e.target.value)}
              />
            </label>
            <label>
              页面标识 slug
              <input
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                value={fields.slug}
                maxLength={80}
                onChange={(e) => update('slug', e.target.value)}
              />
            </label>
          </div>
          <label>
            简介
            <textarea
              value={fields.summary}
              maxLength={2000}
              onChange={(e) => update('summary', e.target.value)}
            />
          </label>
          <label>
            背景故事
            <textarea
              className="story-editor"
              value={fields.background}
              maxLength={50000}
              onChange={(e) => update('background', e.target.value)}
            />
          </label>
          <div className="form-grid">
            <label>
              头像 HTTPS 引用
              <input
                type="url"
                value={fields.avatarUrl}
                placeholder="https://…（选填）"
                onChange={(e) => update('avatarUrl', e.target.value)}
              />
            </label>
            <label>
              标签（每行一个）
              <textarea
                value={fields.tags.join('\n')}
                onChange={(e) => update('tags', e.target.value.split('\n'))}
              />
            </label>
          </div>
          <fieldset>
            <legend>人格分类</legend>
            {categories.map((c) => (
              <label className="checkbox" key={c.id}>
                <input
                  type="checkbox"
                  checked={fields.categoryIds.includes(c.id)}
                  onChange={(e) =>
                    update(
                      'categoryIds',
                      e.target.checked
                        ? [...fields.categoryIds, c.id]
                        : fields.categoryIds.filter((id) => id !== c.id),
                    )
                  }
                />
                {c.name}
              </label>
            ))}
            {!categories.length && <p className="muted">尚无分类，可在下方创建。</p>}
          </fieldset>
          <label>
            完整人格内核 · 原文保存
            <textarea
              className="core-editor"
              spellCheck={false}
              value={fields.coreText}
              maxLength={2000000}
              onChange={(e) => update('coreText', e.target.value)}
            />
          </label>
          <p className="muted">自由填写，不使用固定故事模板。系统不会生成、润色或改写内核。</p>
          <label>
            开场白
            <textarea
              value={fields.openingMessage}
              maxLength={20000}
              onChange={(e) => update('openingMessage', e.target.value)}
            />
          </label>
        </fieldset>
        <div className="editor-actions">
          <button className="button primary" type="submit" disabled={frozen}>
            {busy ? '保存中…' : '保存草稿并创建版本'}
          </button>
          <span role="status">{dirty ? '未保存' : '已同步'}</span>
        </div>
      </form>
      <details className="admin-panel">
        <summary>新增分类</summary>
        <div className="admin-form">
          <label>
            分类名称
            <input value={catName} onChange={(e) => setCatName(e.target.value)} />
          </label>
          <label>
            分类 slug
            <input value={catSlug} onChange={(e) => setCatSlug(e.target.value)} />
          </label>
          <button
            className="button"
            disabled={busy || !catName || !catSlug}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await api.category(catName, catSlug);
                setCategories((await api.categories()).items);
                setCatName('');
                setCatSlug('');
                setNotice('分类已创建。');
              } catch (e) {
                setError(text(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            创建分类
          </button>
        </div>
      </details>
      <div className="admin-panel">
        <h2>发布管理</h2>
        <p className="muted">保存不会自动发布。发布新版本不会改变已有会话固定绑定的内核。</p>
        <div className="admin-actions">
          <button
            className="button primary"
            disabled={frozen || dirty || !persona.draftVersionId || persona.isTest}
            onClick={() => void action('publish')}
          >
            发布当前草稿
          </button>
          <button
            className="button"
            disabled={frozen || dirty || persona.status !== 'published'}
            onClick={() => void action('unpublish')}
          >
            下架人格
          </button>
          <button
            className="button"
            disabled={frozen || dirty}
            onClick={() => void action('archive')}
          >
            安全归档
          </button>
          <Link className="button" href={`/admin/personas/${id}/preview`}>
            管理员版本测试 ↗
          </Link>
        </div>
      </div>
    </>
  );
}
export function AdminVersions({ id }: { id: string }) {
  const [versions, setVersions] = useState<CoreVersion[]>([]),
    [persona, setPersona] = useState<AdminPersona | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [diff, setDiff] = useState<{
      from: CoreVersion;
      to: CoreVersion;
      changedFields: string[];
    } | null>(null);
  async function load() {
    const [v, p] = await Promise.all([api.versions(id), api.get(id)]);
    setVersions(v.items);
    setPersona(p);
    setFrom(v.items[1]?.id ?? v.items[0]?.id ?? '');
    setTo(v.items[0]?.id ?? '');
  }
  useEffect(() => {
    void load().catch((e) => setError(text(e)));
  }, [id]);
  return (
    <>
      <h1>内核版本历史</h1>
      <Link className="text-link" href={`/admin/personas/${id}/edit`}>
        ← 返回编辑器
      </Link>
      <p className="notice">历史版本不可修改。恢复会将历史档案、内核及开场白追加为新草稿版本。</p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="admin-toolbar">
        <label>
          来源版本
          <select aria-label="来源版本" value={from} onChange={(e) => setFrom(e.target.value)}>
            {versions.map((v) => (
              <option value={v.id} key={v.id}>
                v{v.versionNumber}
              </option>
            ))}
          </select>
        </label>
        <label>
          目标版本
          <select aria-label="目标版本" value={to} onChange={(e) => setTo(e.target.value)}>
            {versions.map((v) => (
              <option value={v.id} key={v.id}>
                v{v.versionNumber}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button"
          disabled={!from || !to || busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              setDiff(await api.compare(id, from, to));
            } catch (e) {
              setError(text(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          比较版本
        </button>
      </div>
      {diff && (
        <div className="admin-panel">
          <h2>差异比较</h2>
          <p>变化字段：{diff.changedFields.join('、') || '无变化'}</p>
          <div className="version-diff">
            {[diff.from, diff.to].map((v, i) => (
              <div key={i}>
                <h3>v{v.versionNumber}</h3>
                <h4>人格内核</h4>
                <pre>{v.coreText}</pre>
                <h4>开场白</h4>
                <pre>{v.openingMessage}</pre>
                <h4>资料快照</h4>
                <pre>{JSON.stringify(v.profileSnapshot, null, 2)}</pre>
              </div>
            ))}
          </div>
        </div>
      )}
      {versions.map((v) => (
        <details key={v.id} className="admin-panel">
          <summary>
            v{v.versionNumber} {v.id === persona?.draftVersionId ? '· 当前草稿' : ''}{' '}
            {v.id === persona?.publishedVersionId ? '· 发布版本' : ''} ·{' '}
            {new Date(v.createdAt).toLocaleString()}
          </summary>
          <p className="muted">
            创建人：{v.author?.email ?? v.createdBy}
            {v.restoredFromId ? ' · 恢复自 ' + v.restoredFromId : ''}
          </p>
          <h3>内核原文</h3>
          <pre className="version-source">{v.coreText || '（空白原文）'}</pre>
          <h3>开场白</h3>
          <pre className="version-source">{v.openingMessage}</pre>
          <h3>档案快照</h3>
          <pre className="version-source">{JSON.stringify(v.profileSnapshot, null, 2)}</pre>
          <button
            className="button"
            disabled={busy || !persona || persona.status === 'archived'}
            onClick={async () => {
              if (!persona) return;
              setBusy(true);
              setError('');
              try {
                await api.restore(id, v.id, persona.revision);
                await load();
                setNotice('已恢复为新草稿版本，旧版本保持不变。');
              } catch (e) {
                setError(text(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            恢复 v{v.versionNumber} 为新草稿
          </button>
        </details>
      ))}
      {!versions.length && <p>尚无已保存版本。</p>}
    </>
  );
}
export function AdminPreview({ id }: { id: string }) {
  const [versions, setVersions] = useState<CoreVersion[]>([]),
    [version, setVersion] = useState(''),
    [chat, setChat] = useState<{ id: string; coreVersionId: string } | null>(null),
    [input, setInput] = useState(''),
    [reply, setReply] = useState<Message[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void api
      .versions(id)
      .then((v) => {
        setVersions(v.items);
        setVersion(v.items[0]?.id ?? '');
      })
      .catch((e) => setError(text(e)));
  }, [id]);
  return (
    <>
      <h1>管理员版本测试</h1>
      <Link className="text-link" href={`/admin/personas/${id}/edit`}>
        ← 返回编辑器
      </Link>
      <p className="notice">仅管理员可用 · 模拟回复 · 未接入 DeepSeek。不会使用访客额度。</p>
      <label>
        选择测试版本
        <select
          aria-label="选择测试版本"
          value={version}
          onChange={(e) => {
            setVersion(e.target.value);
            setChat(null);
            setReply([]);
          }}
        >
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              v{v.versionNumber} · {v.id}
            </option>
          ))}
        </select>
      </label>
      <button
        className="button"
        disabled={!version || busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            setChat(await api.test(id, version));
          } catch (e) {
            setError(text(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        建立版本测试会话
      </button>
      {error && <p role="alert">{error}</p>}
      {chat && (
        <>
          <p className="notice">
            测试会话：{chat.id}
            <br />
            固定版本：{chat.coreVersionId}
          </p>
          <form
            className="admin-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                const value = await api.testSend(chat.id, crypto.randomUUID(), input);
                setReply(value.messages);
                setInput('');
              } catch (e) {
                setError(text(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              测试消息
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                required
                maxLength={4000}
              />
            </label>
            <button className="button primary" disabled={busy || !input.trim()}>
              发送模拟测试
            </button>
          </form>
          <div role="log" aria-label="管理员测试消息">
            {reply.map((message) => (
              <div className={'message ' + message.role} key={message.id}>
                <span className="message-label">
                  {message.role === 'user' ? '你' : '模拟回复 · 未接入真实 AI'}
                </span>
                <p>{message.content}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
