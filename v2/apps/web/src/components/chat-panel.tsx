'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { ChatSession, type Persona } from '@pv/shared';
import { ApiError, createClient } from '@pv/api-client';
const api = createClient();
const Pending = z.object({
  clientMessageId: z.string().uuid(),
  content: z.string().min(1).max(4000),
});
const Saved = z.object({
  version: z.literal(1),
  session: ChatSession,
  pending: Pending.nullable(),
});
type Pending = z.infer<typeof Pending>;
const key = (slug: string) => 'pv:v2:chat:' + slug;
function saved(slug: string) {
  try {
    const parsed = Saved.safeParse(JSON.parse(localStorage.getItem(key(slug)) ?? 'null'));
    return parsed.success && parsed.data.session.personaSlug === slug ? parsed.data : null;
  } catch {
    return null;
  }
}
function persist(slug: string, session: ChatSession, pending: Pending | null) {
  try {
    localStorage.setItem(key(slug), JSON.stringify({ version: 1, session, pending }));
    return true;
  } catch {
    return false;
  }
}
export function ChatPanel({ persona, personas }: { persona: Persona; personas: Persona[] }) {
  const [session, setSession] = useState<ChatSession | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  const cancelled = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  async function connect() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await api.visitor();
      const previous = saved(persona.slug);
      let current: ChatSession;
      if (previous) {
        try {
          current = await api.history(previous.session.id);
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 404)) throw e;
          current = await api.createSession(persona.slug);
          setNotice('服务端演示记录已失效，已建立新会话。');
        }
      } else current = await api.createSession(persona.slug);
      if (cancelled.current) return;
      const candidate = previous?.session.id === current.id ? previous.pending : null;
      const alreadySaved =
        candidate &&
        current.messages.some(
          (m) => m.clientMessageId === candidate.clientMessageId && m.role === 'assistant',
        );
      const retry = alreadySaved ? null : candidate;
      setSession(current);
      setPending(retry);
      if (retry) setError('上次消息尚未确认，请点击重试。');
      if (!persist(persona.slug, current, retry))
        setNotice('设备存储不可用，刷新后可能无法恢复会话。');
    } catch {
      if (!cancelled.current) setError('无法连接演示服务，请检查本地 API 后重新连接。');
    } finally {
      lock.current = false;
      if (!cancelled.current) setBusy(false);
    }
  }
  useEffect(() => {
    cancelled.current = false;
    void connect();
    return () => {
      cancelled.current = true;
    };
  }, [persona.slug]); // Each slug owns its own session.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [session?.messages.length]);
  async function send(retry?: Pending) {
    if (lock.current || !session) return;
    const message = retry ?? { clientMessageId: crypto.randomUUID(), content: input.trim() };
    if (!message.content) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setPending(message);
    persist(persona.slug, session, message);
    try {
      const current = await api.send(session.id, message.clientMessageId, message.content);
      if (cancelled.current) return;
      setSession(current);
      setPending(null);
      setInput('');
      persist(persona.slug, current, null);
    } catch (e) {
      if (!cancelled.current) {
        if (e instanceof ApiError && [401, 404].includes(e.status)) {
          setSession(null);
          setPending(null);
          try {
            localStorage.removeItem(key(persona.slug));
          } catch {}
          setInput(message.content);
          setError('演示会话已失效。请重新连接，消息内容已保留。');
        } else
          setError(
            e instanceof ApiError ? e.message : '请求未确认，请点击重试；同一消息不会重复保存。',
          );
      }
    } finally {
      lock.current = false;
      if (!cancelled.current) {
        setBusy(false);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    }
  }
  async function clear() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await api.visitor();
      await api.clear();
      try {
        for (const savedKey of Object.keys(localStorage))
          if (savedKey.startsWith('pv:v2:chat:')) localStorage.removeItem(savedKey);
      } catch {}
      setSession(null);
      setPending(null);
      setInput('');
      const current = await api.createSession(persona.slug);
      setSession(current);
      persist(persona.slug, current, null);
      setNotice('当前设备对应的所有演示会话与本地聊天记录已清除。');
    } catch {
      setError('清除未完成，请检查服务后重试。');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="chat-layout">
      <aside className="chat-sidebar">
        <Link className="text-link" href="/explore">
          ← 返回探索
        </Link>
        <p className="eyebrow">CONVERSATIONS</p>
        {personas.map((p) => (
          <Link
            className={'chat-persona ' + (p.slug === persona.slug ? 'active' : '')}
            key={p.slug}
            href={'/chat/' + p.slug}
          >
            <span className="mini-avatar">{p.slug === 'test-a' ? 'A' : 'B'}</span>
            <span>
              {p.name}
              <small>{p.mock ? '中性测试资料' : '站长发布'}</small>
            </span>
            <span>↗</span>
          </Link>
        ))}
        <div className="sidebar-note">
          <span>关于这段对话</span>
          <p>回复由本地模拟服务提供，不代表真实 AI。演示记录保存在内存中，服务重启后失效。</p>
        </div>
      </aside>
      <div className="chat-main">
        <header className="chat-header">
          <div>
            <span className="mini-avatar">{persona.slug === 'test-a' ? 'A' : 'B'}</span>
            <div>
              <h1>{persona.name}</h1>
              <small>
                <i /> 模拟服务 · 非真实 AI
              </small>
            </div>
          </div>
          <button className="text-link" disabled={busy} onClick={() => void clear()}>
            清除全部聊天
          </button>
        </header>
        <div className="mobile-switch">
          {personas.map((p) => (
            <Link key={p.slug} href={'/chat/' + p.slug}>
              {p.name} ↗
            </Link>
          ))}
        </div>
        <div className="messages" role="log" aria-label="聊天消息" aria-live="polite">
          {!session?.messages.length && (
            <div className="chat-welcome">
              <span className="welcome-symbol">✧</span>
              <p className="eyebrow">A NEW PERSPECTIVE</p>
              <h2>从一句话开始。</h2>
              <p>
                这里是模拟对话空间。
                <br />
                可以连续发送消息，体验聊天流程。
              </p>
              <button
                className="suggestion"
                disabled={busy}
                onClick={() => setInput('你好，测试连续对话。')}
              >
                你好，测试连续对话。 ↗
              </button>
            </div>
          )}
          {session?.messages.map((m) => (
            <div key={m.id} className={'message ' + m.role}>
              <span className="message-label">
                {m.role === 'user' ? '你' : persona.name + ' · MOCK'}
              </span>
              <p>{m.content}</p>
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <div className="composer-area">
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
          {error && (
            <div role="alert" className="chat-error">
              <span>{error}</span>
              <button
                disabled={busy}
                onClick={() =>
                  pending && session ? void send(pending) : session ? void clear() : void connect()
                }
              >
                {pending && session ? '重试消息' : session ? '重建会话' : '重新连接'}
              </button>
            </div>
          )}
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label className="sr-only" htmlFor="message">
              消息
            </label>
            <textarea
              id="message"
              ref={inputRef}
              placeholder="说点什么，让对话开始…"
              value={input}
              maxLength={4000}
              disabled={busy || !session || !!pending}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (!pending) void send();
                }
              }}
            />
            <button
              className="send-button"
              type="submit"
              aria-label="发送消息"
              disabled={busy || !session || !!pending || !input.trim()}
            >
              {busy ? '···' : '↑'}
            </button>
          </form>
          <div className="composer-footer">
            <span>MOCK 模式 · 输入 /fail-once 可测试失败重试</span>
            <span>{session ? `${session.messages.length / 2} 轮` : '连接中'}</span>
          </div>
          <p className="session-id">
            会话 ID：<span data-testid="session-id">{session?.id ?? '尚未建立'}</span>
          </p>
        </div>
      </div>
    </section>
  );
}
