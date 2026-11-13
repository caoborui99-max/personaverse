import { notFound } from 'next/navigation';
import { fixtures } from '@pv/shared';
import { ChatPanel } from '../../../components/chat-panel';
export const metadata = { title: '模拟聊天', robots: { index: false } };
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const persona = fixtures.find((p) => p.slug === slug);
  if (!persona) notFound();
  return <ChatPanel key={slug} persona={persona} />;
}
