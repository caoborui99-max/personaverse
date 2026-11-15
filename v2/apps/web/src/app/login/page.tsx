import { UserAuthForm } from '../../components/user-auth';
export const metadata = { title: '登录', robots: { index: false } };
export default function Page() {
  return <UserAuthForm mode="login" />;
}
