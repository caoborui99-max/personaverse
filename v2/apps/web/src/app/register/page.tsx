import { UserAuthForm } from '../../components/user-auth';
export const metadata = { title: '注册', robots: { index: false } };
export default function Page() {
  return <UserAuthForm mode="register" />;
}
