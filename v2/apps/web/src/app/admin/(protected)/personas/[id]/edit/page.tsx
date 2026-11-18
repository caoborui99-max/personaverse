import { AdminEdit } from '../../../../../../components/admin-workspace';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminEdit id={id} />;
}
