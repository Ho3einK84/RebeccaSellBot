import { describe, expect, it } from 'vitest';
import { validateRebeccaBaseUrl } from '../../src/infra/rebeccaBaseUrl.js';

describe('validateRebeccaBaseUrl', () => {
  it('normalizes a clean HTTPS origin', () => {
    expect(validateRebeccaBaseUrl('https://rebecca.example.com/')).toBe(
      'https://rebecca.example.com'
    );
  });

  it.each([
    'http://rebecca.example.com',
    'https://rebecca.example.com/dashboard/',
    'https://rebecca.example.com?mode=admin',
    'https://rebecca.example.com#settings',
    'https://admin:secret@rebecca.example.com',
  ])('rejects a URL that is not a clean HTTPS origin: %s', (value) => {
    expect(() => validateRebeccaBaseUrl(value)).toThrow();
  });
});
