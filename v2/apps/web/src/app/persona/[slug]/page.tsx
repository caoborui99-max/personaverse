import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fixtures } from '@pv/shared';
import { FavoriteButton } from '../../../components/storage-ui';
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return {
    title: fixtures.find((p) => p.slug === slug)?.name ?? '人格不存在',
    robots: { index: false },
  };
}
export default async function PersonaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = fixtures.find((p) => p.slug === slug);
  if (!p) notFound();
  return (
    <section className="page section">
      <Link className="text-link" href="/explore">
        ← 返回人格广场
      </Link>
      <div className="profile">
        <div className="profile-visual avatar-art">
          <span className="orbit" />
          <span className="orb" />
          <span className="art-label">PERSONA / TEST</span>
        </div>
        <div className="profile-copy">
          <p className="eyebrow">中性测试资料 / MOCK</p>
          <h1>{p.name}</h1>
          <p className="page-description">{p.summary}</p>
          <span className="tag">{p.category}</span>
          <h2>背景档案</h2>
          <p>{p.background}</p>
          <p className="muted">正式名称、背景与人格内核由站长创作。本阶段不生成或发布正式人格。</p>
          <div className="hero-actions">
            <Link className="button primary" href={'/chat/' + p.slug}>
              开始模拟聊天 ↗
            </Link>
            <FavoriteButton slug={p.slug} />
          </div>
        </div>
      </div>
    </section>
  );
}
