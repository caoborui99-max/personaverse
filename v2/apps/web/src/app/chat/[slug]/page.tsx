import { UserBoundary } from '../../../components/user-boundary';
import { notFound } from 'next/navigation';
import { mockMode, publicList, publicPersona, requireUserPage } from '../../../lib/server-api';
import { ChatPanel } from '../../../components/chat-panel';
import { PersonalChat } from '../../../components/user-chat';
export const dynamic = 'force-dynamic';
export const metadata = { title: '模拟聊天', robots: { index: false } };
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const legacy = await mockMode();
  const persona = await publicPersona(slug);
  if (!persona) notFound();
  if (legacy) {
    const list = await publicList();
    return <ChatPanel key={slug} persona={persona} personas={list.items} />;
  }
  const user = await requireUserPage('/chat/' + encodeURIComponent(slug));
  return (
    <UserBoundary userId={user.id}>
      <PersonalChat key={slug} personaSlug={slug} personaName={persona.name} />
    </UserBoundary>
  );
}
