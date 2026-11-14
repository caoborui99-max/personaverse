// Prisma's no-Rust adapter can surface SQLSTATE outside PrismaClientKnownRequestError.
// Inspect only bounded error metadata; never return PostgreSQL detail, SQL, or input values.
export function driverFailure(error: unknown) {
  const record = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  const outer = record(error);
  const nested = record(record(outer?.meta)?.driverAdapterError);
  const adapter =
    outer?.name === 'DriverAdapterError'
      ? outer
      : nested?.name === 'DriverAdapterError'
        ? nested
        : null;
  if (!adapter) return null;
  const cause = record(adapter.cause);
  const state = typeof cause?.originalCode === 'string' ? cause.originalCode : '';
  const mapping: Record<string, [number, string, string]> = {
    '23505': [409, 'DUPLICATE', '唯一字段已被占用。'],
    '23503': [400, 'INVALID_REFERENCE', '关联记录无效。'],
    '23514': [409, 'DATA_INTEGRITY', '数据完整性约束拒绝此更改。'],
    '42501': [409, 'PUBLICATION_INTENT_REQUIRED', '发布状态只能通过明确的发布管理流程修改。'],
    '55P03': [409, 'CONCURRENT_REQUEST', '已有并发请求，请重试。'],
    '40001': [409, 'CONCURRENT_REQUEST', '已有并发请求，请重试。'],
    P0001: [409, 'IMMUTABLE_RECORD', '历史记录不可修改。'],
  };
  const [status, code, message] = mapping[state] ?? [
    503,
    'DATABASE_UNAVAILABLE',
    '数据库暂时不可用。',
  ];
  return { status, code, message };
}
