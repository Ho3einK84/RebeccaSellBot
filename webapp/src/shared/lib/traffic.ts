/**
 * Traffic limit normalization helper for webapp aligned with Rebecca Panel semantics:
 *
 *   limited := DataLimit != nil && *DataLimit > 0 && used >= limit
 *
 * Therefore:
 *  - absent (undefined), null, 0, or <= 0 => null (Unlimited)
 *  - positive integers (> 0) => byte count (Limited)
 *  - NaN / unparseable non-numbers => undefined (Unknown)
 */
export function normalizeDataLimit(value: unknown): number | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'bigint') {
    if (value <= 0n) return null;
    return Number(value);
  }
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return undefined;
    if (value <= 0) return null;
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const num = Number(trimmed);
    if (Number.isNaN(num)) return undefined;
    if (num <= 0) return null;
    return Math.floor(num);
  }
  return undefined;
}
