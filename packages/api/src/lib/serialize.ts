/**
 * Converts BigInt fields to numbers for JSON serialization.
 * PostgreSQL bigint columns via Drizzle return JS BigInt values,
 * but JSON.stringify throws on BigInt.
 */
export function serializeRow<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    result[key] = typeof value === 'bigint' ? Number(value) : value;
  }
  return result;
}

export function serializeRows<T extends Record<string, unknown>>(
  rows: T[],
): Record<string, unknown>[] {
  return rows.map(serializeRow);
}
