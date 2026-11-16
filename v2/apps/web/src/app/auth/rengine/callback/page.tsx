import { RengineCallback } from '../../../../components/rengine-binding';
export const metadata = {
  title: '外部身份回调',
  robots: { index: false },
  referrer: 'no-referrer' as const,
};
export default function Page() {
  return <RengineCallback />;
}
