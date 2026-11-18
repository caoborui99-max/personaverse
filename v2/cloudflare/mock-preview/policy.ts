export const unavailableMailPaths = new Set([
  '/api/v1/auth/register',
  '/api/v1/auth/verify',
  '/api/v1/auth/resend-verification',
  '/api/v1/auth/forgot-password',
  '/api/v1/auth/reset-password',
]);
export function previewOrigin(value: string) {
  const u = new URL(value);
  if (
    u.protocol !== 'https:' ||
    u.port !== '' ||
    u.origin !== value ||
    !/^[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(u.hostname)
  )
    throw new Error('EXACT_PREVIEW_HTTPS_ORIGIN_REQUIRED');
  return value;
}
export function previewDatabase(value: string, database: string, role: string) {
  const u = new URL(value);
  if (
    !/^pv_mock_[a-z0-9_]+$/.test(database) ||
    !/^pv_mock_app_[a-z0-9_]+$/.test(role) ||
    !['postgres:', 'postgresql:'].includes(u.protocol) ||
    decodeURIComponent(u.pathname.slice(1)) !== database ||
    decodeURIComponent(u.username) !== role
  )
    throw new Error('ISOLATED_PREVIEW_DATABASE_REQUIRED');
  return value;
}
export function previewPath(request: Request) {
  try {
    const path = decodeURIComponent(new URL(request.url).pathname);
    return (
      !path.includes('\\') &&
      !path.includes('//') &&
      !path.startsWith('/__local') &&
      path.startsWith('/api/v1/')
    );
  } catch {
    return false;
  }
}

// Read-only preflight: a matching role name alone does not prove least privilege.
export async function assertPreviewRole(
  read: (sql: string) => Promise<{ role: string; database: string; privileged: boolean }[]>,
  role: string,
  database: string,
) {
  const rows = await read(`SELECT current_user AS role, current_database() AS database,
    (EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls))
    OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname='public' AND r.rolname=current_user)
    OR has_schema_privilege(current_user,'public','CREATE')
    OR has_table_privilege(current_user,'public."AiControl"','UPDATE')) AS privileged`);
  if (
    rows.length !== 1 ||
    rows[0]!.role !== role ||
    rows[0]!.database !== database ||
    rows[0]!.privileged
  )
    throw new Error('LEAST_PRIVILEGE_ROLE_REQUIRED');
}
