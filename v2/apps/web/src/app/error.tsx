'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="empty page">
      <h1>页面暂时无法加载</h1>
      <p>请重试。当前操作不会影响旧版系统。</p>
      <button className="button" onClick={reset}>
        重新加载
      </button>
    </section>
  );
}
