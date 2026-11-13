import { notFound } from 'next/navigation';
import { publicList, publicPersona } from '../../../lib/server-api';
export const dynamic = 'force-dynamic';
import { ChatPanel } from '../../../components/chat-panel';
export const metadata = { title: '模拟聊天', robots: { index: false } };
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const persona = await publicPersona(slug);
  const list = await publicList();
  if (!persona) notFound();
  return <ChatPanel key={slug} persona={persona} personas={list.items} />;
}
