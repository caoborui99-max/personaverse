import Link from 'next/link';
import { AdminPassword } from '../../../components/admin-workspace';
export default function Admin() {
  return (
    <>
      <h1>站长工作空间</h1>
      <p className="page-description">人格内容由你亲自创作。保存形成新版本，发布由你明确决定。</p>
      <div className="admin-actions">
        <Link className="button primary" href="/admin/personas">
          管理人格 ↗
        </Link>
        <Link className="button" href="/admin/personas/new">
          创建空白草稿
        </Link>
      </div>
      <p className="notice">真实模型尚未接入。管理员预览仅提供明确标记的模拟测试。</p>
      <AdminPassword />
    </>
  );
}
