import { publicList, publicCategories } from '../../lib/server-api';
export const dynamic = 'force-dynamic';
import { ExploreBrowser } from '../../components/explore-browser';
export const metadata = { title: '人格广场' };
export default async function Explore() {
  const [initial, categories] = await Promise.all([publicList(), publicCategories()]);
  return (
    <section className="page section">
      <p className="eyebrow">EXPLORE THE PERSONAVERSE</p>
      <h1>寻找你的下一种视角。</h1>
      <p className="page-description">
        不止一种性格，不止一种可能。公开资料由站长发布，真实模型尚未接入。
      </p>
      <ExploreBrowser initial={initial} categories={categories} />
    </section>
  );
}
