import { Favorites } from '../../components/storage-ui';
import { UserBoundary } from '../../components/user-boundary';
import { mockMode, requireUserPage } from '../../lib/server-api';
export const dynamic = 'force-dynamic';
export const metadata = { title: '我的收藏', robots: { index: false } };
export default async function Page() {
  const mock = await mockMode();
  const user = mock ? null : await requireUserPage('/favorites');
  const content = (
    <section className="page section">
      <p className="eyebrow">YOUR COLLECTION</p>
      <h1>留住感兴趣的相遇。</h1>
      <p className="page-description">
        {mock
          ? '模拟回归模式：收藏仅保存在当前设备。'
          : '登录后的收藏与账户关联，可在不同设备查看。'}
      </p>
      <Favorites mock={mock} />
    </section>
  );
  return user ? <UserBoundary userId={user.id}>{content}</UserBoundary> : content;
}
