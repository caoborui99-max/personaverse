import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
export const metadata: Metadata = {
  title: { default: 'PersonaVerse · 人格宇宙', template: '%s · PersonaVerse' },
  description: '人格宇宙 V2 基础工程演示。探索人格、背景与对话体验。',
};
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <a className="skip" href="#main">
          跳转到内容
        </a>
        <header className="topbar">
          <Link href="/" className="brand">
            <span className="brand-icon">
              p<span>v</span>
            </span>
            <span>
              PersonaVerse<small>人格宇宙</small>
            </span>
          </Link>
          <nav className="desktop-nav">
            <Link href="/">首页</Link>
            <Link href="/explore">人格广场</Link>
            <Link href="/favorites">我的收藏</Link>
          </nav>
          <span className="mode">
            <i /> AI 未接入
          </span>
        </header>
        <main id="main">{children}</main>
        <footer>
          <span>
            PersonaVerse <span className="muted">/ 人格宇宙</span>
          </span>
          <span>探索不同视角，开启更多可能。</span>
          <Link href="/admin/login">管理入口 ↗</Link>
        </footer>
        <nav className="mobile-nav" aria-label="主导航">
          <Link href="/">
            ⌂<span>首页</span>
          </Link>
          <Link href="/explore">
            ◉<span>探索</span>
          </Link>
          <Link href="/favorites">
            ♡<span>收藏</span>
          </Link>
        </nav>
      </body>
    </html>
  );
}
