import { UserAuthForm } from '../../components/user-auth';
export const metadata = { title: '验证邮箱', robots: { index: false } };
export default function Page() {
  return <UserAuthForm mode="verify" />;
}
