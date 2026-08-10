import { describe, expect, it } from 'vitest';
import { dbIntegerToSafeNumber } from '../../src/domain/services/DbNumber.js';

describe('dbIntegerToSafeNumber', () => {
  it('accepts safe PostgreSQL bigint strings without losing precision', () => {
    expect(dbIntegerToSafeNumber('9007199254740991', 'amount')).toBe(Number.MAX_SAFE_INTEGER);
    expect(dbIntegerToSafeNumber('-42', 'amount')).toBe(-42);
  });

  it('fails closed instead of rounding an unsafe financial aggregate', () => {
    expect(() => dbIntegerToSafeNumber('9007199254740992', 'amount')).toThrow(
      'UNSAFE_DB_INTEGER:amount'
    );
  });
});
