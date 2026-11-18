import { UserBoundary } from '../../components/user-boundary';
import { requireUserPage } from '../../lib/server-api';
import { PersonalHistory } from '../../components/user-history';
export const dynamic = 'force-dynamic';
export const metadata = { title: '我的聊天记录', robots: { index: false } };
export default async function Page() {
  const user = await requireUserPage('/history');
  return (
    <UserBoundary userId={user.id}>
      <PersonalHistory />
    </UserBoundary>
  );
}
