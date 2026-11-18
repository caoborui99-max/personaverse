import { UserAuthForm } from '../../components/user-auth';
export const metadata = { title: '找回密码', robots: { index: false } };
export default function Page() {
  return <UserAuthForm mode="forgot" />;
}
