import { notFound } from 'next/navigation';
import { rengineCallbackEnabled } from '../../../../lib/server-api';
import { RengineCallback } from '../../../../components/rengine-binding';
export const metadata = {
  title: '外部身份回调',
  robots: { index: false },
  referrer: 'no-referrer' as const,
};
export const dynamic = 'force-dynamic';
export default async function Page() {
  if (!(await rengineCallbackEnabled())) notFound();
  return <RengineCallback />;
}
