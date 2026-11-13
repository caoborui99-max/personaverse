import Link from 'next/link';
import { fixtures } from '@pv/shared';
import { PersonaCard } from '../components/persona-card';
export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">
            <span /> A UNIVERSE OF PERSPECTIVES
          </p>
          <h1>
            每一种人格，
            <br />
            都是一个<span>新宇宙。</span>
          </h1>
          <p className="hero-description">
            从一个不同的视角出发。
            <br />
            探索故事、交流想法，让好奇心有处可去。
          </p>
          <div className="hero-actions">
            <Link className="button primary" href="/explore">
              探索人格宇宙 <span>↗</span>
            </Link>
            <span className="hero-note">无需注册 · 即刻探索</span>
          </div>
          <div className="hero-stats">
            <span>
              <strong>01</strong>探索不同人格
            </span>
            <span>
              <strong>02</strong>发现新的视角
            </span>
            <span>
              <strong>03</strong>开启一段对话
            </span>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="axis axis-one" />
          <div className="axis axis-two" />
          <div className="sphere">
            <span>pv</span>
          </div>
          <span className="art-coordinate">PERSPECTIVE / ∞</span>
          <span className="art-number">PV—02</span>
          <span className="art-cross">+</span>
        </div>
      </section>
      <section className="section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">YOUR NEXT CONVERSATION</p>
            <h2>从一次相遇开始</h2>
          </div>
          <Link className="text-link" href="/explore">
            查看全部 ↗
          </Link>
        </div>
        <p className="notice">
          基础工程预览 · 以下均为中性测试数据，聊天使用模拟回复，尚未接入真实 AI。
        </p>
        <div className="persona-grid">
          {fixtures.map((p, i) => (
            <PersonaCard key={p.slug} persona={p} index={i} />
          ))}
        </div>
      </section>
      <section className="closing">
        <span>保持好奇。</span>
        <p>下一种视角，或许就在下一次对话里。</p>
        <Link href="/explore">继续探索 ↗</Link>
      </section>
    </>
  );
}
