'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChatAllowancePanel } from './chat-allowance';
import { createUserClient, UserApiError, type PersonalConversation } from '@pv/api-client';
const api = createUserClient();
type Pending = { clientMessageId: string; content: string };
function creationKey() {
  const url = new URL(window.location.href),
    previous = url.searchParams.get('request');
  if (
    previous &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(previous)
  )
    return previous;
  const id = crypto.randomUUID();
  url.searchParams.set('request', id);
  window.history.replaceState(null, '', url.pathname + url.search);
  return id;
}
export function PersonalChat({
  sessionId,
  personaSlug,
  personaName,
}: {
  sessionId?: string;
  personaSlug?: string;
  personaName?: string;
}) {
  const router = useRouter();
  const [quotaAllowed, setQuotaAllowed] = useState(true);
  const [quotaRevision, setQuotaRevision] = useState(0);
  const [session, setSession] = useState<PersonalConversation | null>(null),
    [input, setInput] = useState(''),
    [pending, setPending] = useState<Pending | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [missing, setMissing] = useState(false);
  const lock = useRef(false),
    live = useRef(true),
    pendingRef = useRef<Pending | null>(null),
    inputRef = useRef<HTMLTextAreaElement>(null),
    endRef = useRef<HTMLDivElement>(null),
    skipScroll = useRef(false);
  function accepted(current: PersonalConversation) {
    const unresolved = pendingRef.current;
    const persisted =
      unresolved &&
      current.messages.some(
        (m) => m.clientMessageId === unresolved.clientMessageId && m.role === 'assistant',
      );
    setSession((previous) => {
      if (!previous || previous.id !== current.id) return current;
      const incoming = new Set(current.messages.map((m) => m.id));
      const earlier = previous.messages.filter((m) => !incoming.has(m.id));
      return earlier.length
        ? {
            ...current,
            messages: [...earlier, ...current.messages],
            pagination: previous.pagination ?? current.pagination,
          }
        : current;
    });
    if (persisted) {
      setPending(null);
      pendingRef.current = null;
      setInput('');
    }
  }
  function fail(e: unknown) {
    if (e instanceof UserApiError && e.status === 401) {
      window.location.assign(
        '/login?next=' + encodeURIComponent(window.location.pathname + window.location.search),
      );
      return;
    }
    if (e instanceof UserApiError && e.status === 404) {
      setMissing(true);
      setSession(null);
      setPending(null);
      pendingRef.current = null;
      setInput('');
    }
    setError(e instanceof Error ? e.message : '请求未确认。请重新读取记录或使用原消息重试。');
  }
  async function connect() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const current = sessionId
        ? await api.history(sessionId)
        : await api.createSession(personaSlug!, creationKey());
      if (!live.current) return;
      accepted(current);
      if (!sessionId) router.replace('/history/' + current.id);
    } catch (e) {
      if (live.current) fail(e);
    } finally {
      lock.current = false;
      if (live.current) setBusy(false);
    }
  }
  useEffect(() => {
    live.current = true;
    void connect();
    return () => {
      live.current = false;
    };
  }, [sessionId, personaSlug]);
  useEffect(() => {
    if (skipScroll.current) {
      skipScroll.current = false;
      return;
    }
    endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [session?.messages.length]);
  async function send(retry?: Pending) {
    if (lock.current || !session || session.canSend !== true || !quotaAllowed) return;
    const message = retry ?? { clientMessageId: crypto.randomUUID(), content: input };
    if (!message.content.trim()) return;
    lock.current = true;
    setBusy(true);
    setError('');
    pendingRef.current = message;
    setPending(message);
    try {
      const current = await api.send(session.id, message.clientMessageId, message.content);
      if (live.current) accepted(current);
    } catch (e) {
      if (live.current) {
        if (
          e instanceof UserApiError &&
          ['PERSONAL_TOKEN_LIMIT', 'CHAT_ALLOWANCE_EXHAUSTED'].includes(e.code)
        ) {
          pendingRef.current = null;
          setPending(null);
          setInput(message.content);
        }
        fail(e);
      }
    } finally {
      lock.current = false;
      if (live.current) {
        setQuotaRevision((v) => v + 1);
        setBusy(false);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    }
  }
  async function older() {
    if (
      lock.current ||
      !session ||
      !session.pagination?.hasMore ||
      session.pagination.nextBefore === null
    )
      return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const previous = await api.history(session.id, session.pagination.nextBefore);
      if (!live.current) return;
      const known = new Set(session.messages.map((m) => m.id));
      skipScroll.current = true;
      setSession({
        ...session,
        canSend: previous.canSend,
        messages: [...previous.messages.filter((m) => !known.has(m.id)), ...session.messages],
        pagination: previous.pagination,
      });
    } catch (e) {
      if (live.current) fail(e);
    } finally {
      lock.current = false;
      if (live.current) setBusy(false);
    }
  }
  async function remove() {
    if (
      lock.current ||
      !session ||
      !window.confirm('删除这段个人聊天？删除后无法继续访问，也无法恢复。')
    )
      return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await api.removeChat(session.id);
      setSession(null);
      setPending(null);
      pendingRef.current = null;
      setInput('');
      router.replace('/history');
    } catch (e) {
      fail(e);
    } finally {
      lock.current = false;
      if (live.current) setBusy(false);
    }
  }
  const name = session?.personaName ?? personaName ?? '个人聊天';
  return (
    <section className="chat-layout personal-chat-layout">
      <aside className="chat-sidebar">
        <Link href="/history" className="text-link">
          ← 我的聊天记录
        </Link>
        <p className="eyebrow">YOUR CONVERSATION</p>
        <h2>{name}</h2>
        <Link href="/explore" className="text-link">
          探索更多人格 ↗
        </Link>
        <div className="sidebar-note">
          <span>由账户保存的记录</span>
          <p>
            消息保存在服务端。退出或更换设备后，重新登录即可恢复。当前回复仍为模拟内容，未接入真实
            AI。
          </p>
        </div>
      </aside>
      <div className="chat-main">
        <header className="chat-header">
          <div>
            <span className="mini-avatar">✧</span>
            <div>
              <h1>{name}</h1>
              <small>模拟对话 · 服务端保存</small>
            </div>
          </div>
          <button className="text-link" disabled={busy || !session} onClick={() => void remove()}>
            删除这段聊天
          </button>
        </header>
        <div className="mobile-switch">
          <Link href="/history">← 我的记录</Link>
          <Link href="/explore">开启新对话 ↗</Link>
        </div>
        <div className="messages" role="log" aria-label="聊天消息" aria-live="polite">
          {session?.pagination?.hasMore && (
            <button className="button history-older" disabled={busy} onClick={() => void older()}>
              加载更早消息
            </button>
          )}
          {!session?.messages.length && !missing && (
            <div className="chat-welcome">
              <span className="welcome-symbol">✧</span>
              <p className="eyebrow">A CONVERSATION TO KEEP</p>
              <h2>{busy ? '正在读取记录…' : '从一句话开始。'}</h2>
              <p>
                聊天会保存在你的账户中。
                <br />
                {session?.mode === 'deepseek'
                  ? 'DeepSeek AI 回复，请核实重要信息。'
                  : '当前为模拟回复，真实 AI 尚未接入。'}
              </p>
            </div>
          )}
          {session?.messages.map((m) => (
            <div key={m.id} className={'message ' + m.role}>
              <span className="message-label">{m.role === 'user' ? '你' : name + ' · MOCK'}</span>
              <p>{m.content}</p>
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <div className="composer-area">
          {session && (
            <ChatAllowancePanel
              chatId={session.id}
              revision={session.messages.length + quotaRevision}
              onAllowed={setQuotaAllowed}
            />
          )}
          {session && session.canSend !== true && (
            <p role="status" className="notice">
              这段历史记录仍可查看。会话已关闭，或人格已下架，暂时不能发送新消息。
            </p>
          )}
          {error && (
            <div role="alert" className="chat-error">
              <span>{error}</span>
              {!missing && (
                <div className="account-links">
                  {pending && session && (
                    <button
                      disabled={busy || session.canSend !== true || !quotaAllowed}
                      onClick={() => void send(pending)}
                    >
                      重试消息
                    </button>
                  )}
                  <button disabled={busy} onClick={() => void connect()}>
                    重新读取记录
                  </button>
                </div>
              )}
            </div>
          )}
          {missing && (
            <p className="notice">
              <Link href="/history">返回我的聊天记录 ↗</Link>
            </p>
          )}
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label className="sr-only" htmlFor="personal-message">
              消息
            </label>
            <textarea
              id="personal-message"
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={4000}
              disabled={busy || !session || session.canSend !== true || !quotaAllowed || !!pending}
              placeholder="写下一句话…"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (!pending) void send();
                }
              }}
            />
            <button
              className="send-button"
              aria-label="发送消息"
              disabled={
                busy ||
                !session ||
                session.canSend !== true ||
                !quotaAllowed ||
                !!pending ||
                !input.trim()
              }
            >
              {busy ? '···' : '↑'}
            </button>
          </form>
          <div className="composer-footer">
            <span>MOCK 模式 · 非真实 AI · 消息保存在账户中</span>
            <span>
              {session
                ? session.messages.filter((m) => m.role === 'user').length + ' 轮'
                : '连接中'}
            </span>
          </div>
          <p className="session-id">
            会话 ID：<span data-testid="session-id">{session?.id ?? '尚未建立'}</span>
          </p>
        </div>
      </div>
    </section>
  );
}
