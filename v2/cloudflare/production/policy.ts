// Read-only preflight: a matching role name alone does not prove least privilege.
export async function assertProductionRole(
  read: (sql: string) => Promise<{ role: string; database: string; privileged: boolean }[]>,
  role: string,
  database: string,
) {
  const rows = await read(`SELECT current_user AS role, current_database() AS database,
    (EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls))
    OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname='public' AND r.rolname=current_user)
    OR has_schema_privilege(current_user,'public','CREATE')
    OR has_column_privilege(current_user,'public."AiControl"','maxRequestUnits','UPDATE')
    OR has_column_privilege(current_user,'public."AiBudget"','limitUnits','UPDATE')) AS privileged`);
  if (
    rows.length !== 1 ||
    rows[0]!.role !== role ||
    rows[0]!.database !== database ||
    rows[0]!.privileged
  )
    throw new Error('LEAST_PRIVILEGE_ROLE_REQUIRED');
}

export function productionOrigin(value: string) {
  const u = new URL(value);
  if (
    u.protocol !== 'https:' ||
    u.origin !== value ||
    u.port ||
    u.username ||
    u.password ||
    u.hostname.endsWith('.invalid') ||
    value.includes('REPLACE')
  )
    throw new Error('PRODUCTION_HTTPS_ORIGIN_REQUIRED');
  return value;
}
export function productionDatabase(value: string, database: string, role: string) {
  const u = new URL(value);
  if (
    !database ||
    !role ||
    !['postgres:', 'postgresql:'].includes(u.protocol) ||
    decodeURIComponent(u.pathname.slice(1)) !== database ||
    decodeURIComponent(u.username) !== role
  )
    throw new Error('PRODUCTION_DATABASE_BINDING_REQUIRED');
  return value;
}
