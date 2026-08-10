const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_BIGINT = -MAX_SAFE_BIGINT;

/**
 * PostgreSQL `bigint` aggregates are commonly returned as strings by `pg`.
 * Converting them with Number(...) can silently round values past JS's safe
 * integer range, which is unacceptable for financial totals.
 */
export function dbIntegerToSafeNumber(value: unknown, label: string): number {
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value)) return value;
    throw new Error(`UNSAFE_DB_INTEGER:${label}`);
  }

  let parsed: bigint;
  if (typeof value === 'bigint') {
    parsed = value;
  } else if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    parsed = BigInt(value.trim());
  } else {
    throw new Error(`INVALID_DB_INTEGER:${label}`);
  }

  if (parsed < MIN_SAFE_BIGINT || parsed > MAX_SAFE_BIGINT) {
    throw new Error(`UNSAFE_DB_INTEGER:${label}`);
  }
  return Number(parsed);
}
