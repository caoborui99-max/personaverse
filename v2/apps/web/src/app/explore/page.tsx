import { ExploreBrowser } from '../../components/explore-browser';
export const metadata = { title: '人格广场' };
export default function Explore() {
  return (
    <section className="page section">
      <p className="eyebrow">EXPLORE THE PERSONAVERSE</p>
      <h1>寻找你的下一种视角。</h1>
      <p className="page-description">不止一种性格，不止一种可能。这里展示的均为中性测试资料。</p>
      <ExploreBrowser />
    </section>
  );
}
