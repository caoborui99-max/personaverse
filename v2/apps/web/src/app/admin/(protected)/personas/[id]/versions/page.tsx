import { AdminVersions } from '../../../../../../components/admin-workspace';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminVersions id={id} />;
}
