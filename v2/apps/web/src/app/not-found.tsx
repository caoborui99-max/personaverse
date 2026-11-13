import Link from 'next/link';
export default function NotFound() {
  return (
    <section className="empty page">
      <p className="eyebrow">404 / UNEXPLORED SPACE</p>
      <h1>这个坐标还没有人格。</h1>
      <p>链接可能无效，或资料尚未公开。</p>
      <Link className="button" href="/explore">
        返回人格广场
      </Link>
    </section>
  );
}
