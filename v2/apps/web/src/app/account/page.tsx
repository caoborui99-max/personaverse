import { RengineBinding } from '../../components/rengine-binding';
import { UserBoundary } from '../../components/user-boundary';
import { requireUserPage } from '../../lib/server-api';
import { UserAccount } from '../../components/user-account';
export const dynamic = 'force-dynamic';
export const metadata = { title: '个人中心', robots: { index: false } };
export default async function Page() {
  const user = await requireUserPage('/account');
  return (
    <UserBoundary userId={user.id}>
      <UserAccount initial={user} />
      <RengineBinding />
    </UserBoundary>
  );
}
