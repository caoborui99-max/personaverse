'use client';
import { useEffect, useRef, useState } from 'react';
import { createUserClient } from '@pv/api-client';
import type { ChatAllowance } from '@pv/shared';
const api = createUserClient();
export function ChatAllowancePanel({
  chatId,
  revision,
  onAllowed,
}: {
  chatId: string;
  revision: number;
  onAllowed: (value: boolean) => void;
}) {
  const [value, setValue] = useState<ChatAllowance | null>(null);
  const [error, setError] = useState('');
  const state = useRef<ChatAllowance | null>(null);
  const activeInput = useRef(false);
  useEffect(() => {
    let live = true,
      busy = false;
    const update = (s: ChatAllowance) => {
      if (!live) return;
      state.current = s;
      setValue(s);
      onAllowed(s.canSend);
      setError('');
    };
    const refresh = async () => {
      try {
        update(await api.allowance());
      } catch {
        if (live) {
          setError('额度状态未确认，请刷新。');
          onAllowed(false);
        }
      }
    };
    const mark = () => {
      if (document.visibilityState === 'visible') activeInput.current = true;
    };
    const tick = async () => {
      if (busy || document.visibilityState !== 'visible' || !navigator.onLine) return;
      busy = true;
      try {
        const s = state.current;
        if (
          document.visibilityState === 'visible' &&
          navigator.onLine &&
          s?.canControl &&
          s.chatId === chatId &&
          s.leaseId
        ) {
          const action = activeInput.current ? 'activity' : 'heartbeat';
          activeInput.current = false;
          update(await api.activity(chatId, action, s.leaseId));
        } else if (
          document.visibilityState === 'visible' &&
          navigator.onLine &&
          s &&
          !s.active &&
          activeInput.current &&
          s.canSend
        ) {
          activeInput.current = false;
          update(await api.activity(chatId, 'start'));
        } else await refresh();
      } catch {
        await refresh();
      } finally {
        busy = false;
      }
    };
    const pause = () => {
      const s = state.current;
      if (s?.canControl && s.chatId === chatId && s.leaseId)
        void api.activity(chatId, 'pause', s.leaseId).catch(() => {});
    };
    const visibility = () => {
      if (document.visibilityState !== 'visible') pause();
      else void refresh();
    };
    for (const name of ['keydown', 'pointerdown', 'wheel'])
      window.addEventListener(name, mark, { passive: true });
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', pause);
    void refresh();
    const timer = setInterval(() => void tick(), 10000);
    return () => {
      live = false;
      clearInterval(timer);
      for (const name of ['keydown', 'pointerdown', 'wheel'])
        window.removeEventListener(name, mark);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', pause);
      pause();
    };
  }, [chatId]);
  useEffect(() => {
    let live = true;
    void api
      .allowance()
      .then((s) => {
        if (live) {
          state.current = s;
          setValue(s);
          onAllowed(s.canSend);
        }
      })
      .catch(() => {
        if (live) onAllowed(false);
      });
    return () => {
      live = false;
    };
  }, [chatId, revision]);
  const seconds = Math.ceil((value?.remainingMs ?? 0) / 1000);
  return (
    <div className="notice" data-testid="chat-allowance" aria-live="polite">
      {value ? (
        <>
          <p>
            今日免费聊天：{Math.floor(seconds / 60)}分{seconds % 60}秒 / 60分钟 · 服务端确认
          </p>
          <p>
            Token保护额度：{value.remainingTokens.toLocaleString()} /{' '}
            {value.dailyTokens.toLocaleString()}（保守上界，非实际账单）
          </p>
          <p>
            {!value.canSend
              ? '今日额度已用完'
              : value.active
                ? value.canControl
                  ? '活动计时中 · 5分钟无活动暂停'
                  : '其他设备正在计时，发送消息可接管'
                : '已暂停 · 发消息后开始计时'}{' '}
            · 每天北京时间00:00重置
          </p>
        </>
      ) : (
        <p>正在确认服务端额度…</p>
      )}
      {error && <p>{error}</p>}
    </div>
  );
}
