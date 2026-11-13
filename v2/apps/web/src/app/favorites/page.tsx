import { Favorites } from '../../components/storage-ui';
export const metadata = { title: '我的收藏', robots: { index: false } };
export default function Page() {
  return (
    <section className="page section">
      <p className="eyebrow">YOUR COLLECTION</p>
      <h1>留住感兴趣的相遇。</h1>
      <p className="page-description">收藏保存在当前设备，不会跨设备同步。</p>
      <Favorites />
    </section>
  );
}
