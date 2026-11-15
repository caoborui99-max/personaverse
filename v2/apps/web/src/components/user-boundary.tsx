'use client';
import { useEffect, useRef, useState } from 'react';
import { createUserClient } from '@pv/api-client';
const CHANNEL = 'pv-user-session';
const EXIT = 'pv-user-session-exit';
const RESUME = 'pv-user-session-resume';
// Mark an intentional exit before its first request: background session checks must not
// race the caller's confirmed destination. Private content stays hidden until success or revalidation.
export function prepareUserSessionExit(destination: '/login' | '/login?closed=1') {
  window.dispatchEvent(new Event(EXIT));
  return {
    complete() {
      announceUserSessionChange();
      window.location.replace(destination);
    },
    cancel() {
      window.dispatchEvent(new Event(RESUME));
    },
  };
}
export function announceUserSessionChange() {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(CHANNEL);
  channel.postMessage('session-changed');
  channel.close();
}
export function UserBoundary({ userId, children }: { userId: string; children: React.ReactNode }) {
  const [checking, setChecking] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true,
      working = false,
      departing = false,
      recheck = false;
    const api = createUserClient();
    function hide() {
      if (content.current) content.current.hidden = true;
      setChecking(true);
    }
    async function verify() {
      if (!live || departing) return;
      if (working) {
        recheck = true;
        return;
      }
      working = true;
      hide();
      try {
        const s = await api.session();
        if (!live || departing) return;
        if (s.user.id !== userId) {
          departing = true;
          window.location.replace('/account');
          return;
        }
        if (content.current) content.current.hidden = false;
        setChecking(false);
      } catch {
        if (live && !departing) {
          departing = true;
          window.location.replace(
            '/login?next=' + encodeURIComponent(window.location.pathname + window.location.search),
          );
        }
      } finally {
        working = false;
        if (recheck && live && !departing) {
          recheck = false;
          void verify();
        }
      }
    }
    const exit = () => {
      departing = true;
      recheck = false;
      hide();
    };
    const resume = () => {
      departing = false;
      void verify();
    };
    window.addEventListener(EXIT, exit);
    window.addEventListener(RESUME, resume);
    const focus = () => {
      void verify();
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') hide();
      else void verify();
    };
    const show = () => {
      void verify();
    };
    window.addEventListener('focus', focus);
    window.addEventListener('pageshow', show);
    window.addEventListener('pagehide', hide);
    document.addEventListener('visibilitychange', visibility);
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);
    if (channel) channel.onmessage = focus;
    return () => {
      live = false;
      channel?.close();
      window.removeEventListener(EXIT, exit);
      window.removeEventListener(RESUME, resume);
      window.removeEventListener('focus', focus);
      window.removeEventListener('pageshow', show);
      window.removeEventListener('pagehide', hide);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [userId]);
  return (
    <>
      {checking && (
        <p className="notice session-check" role="status">
          正在确认个人会话…
        </p>
      )}
      <div className="private-boundary" ref={content} hidden={checking}>
        {children}
      </div>
    </>
  );
}
