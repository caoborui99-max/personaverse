import { UserBoundary } from '../../../components/user-boundary';
import { requireUserPage } from '../../../lib/server-api';
import { PersonalChat } from '../../../components/user-chat';
export const dynamic = 'force-dynamic';
export const metadata = { title: '个人聊天记录', robots: { index: false } };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUserPage('/history/' + encodeURIComponent(id));
  return (
    <UserBoundary userId={user.id}>
      <PersonalChat key={id} sessionId={id} />
    </UserBoundary>
  );
}
