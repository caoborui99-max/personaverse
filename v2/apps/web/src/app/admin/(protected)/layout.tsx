import Link from 'next/link';
import { requireAdminPage } from '../../../lib/server-api';
import { AdminLogout } from '../../../components/admin-workspace';
export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };
export default async function Layout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdminPage();
  return (
    <section className="admin-shell section">
      <div className="admin-bar">
        <div>
          <p className="eyebrow">PERSONAVERSE / STUDIO</p>
          <p>
            {admin.email} · {admin.role}
          </p>
        </div>
        <nav>
          <Link href="/admin">概览</Link>
          <Link href="/admin/personas">人格管理</Link>
          <AdminLogout />
        </nav>
      </div>
      {children}
    </section>
  );
}
