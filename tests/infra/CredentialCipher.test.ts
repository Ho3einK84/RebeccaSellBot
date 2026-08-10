import { describe, expect, it } from 'vitest';
import { CredentialCipher } from '../../src/infra/CredentialCipher.js';

describe('CredentialCipher', () => {
  it('round-trips a secret without storing plaintext', () => {
    const cipher = new CredentialCipher('deployment-key-1');
    const plaintext = 'rebecca-api-key-super-secret';
    const encrypted = cipher.encrypt(plaintext);

    expect(encrypted).toMatch(/^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/u);
    expect(encrypted).not.toContain(plaintext);
    expect(cipher.decrypt(encrypted)).toBe(plaintext);
  });

  it('uses a fresh authenticated nonce for every encryption', () => {
    const cipher = new CredentialCipher('deployment-key-2');

    const first = cipher.encrypt('same-api-key');
    const second = cipher.encrypt('same-api-key');

    expect(first).not.toBe(second);
    expect(cipher.decrypt(first)).toBe('same-api-key');
    expect(cipher.decrypt(second)).toBe('same-api-key');
  });

  it('rejects tampering and the wrong deployment key', () => {
    const encrypted = new CredentialCipher('correct-key').encrypt('secret')!;
    const parts = encrypted.split(':');
    parts[3] = `${parts[3]!.slice(0, 1) === 'A' ? 'B' : 'A'}${parts[3]!.slice(1)}`;

    expect(() => new CredentialCipher('correct-key').decrypt(parts.join(':'))).toThrow(
      'PANEL_CREDENTIAL_DECRYPT_FAILED'
    );
    expect(() => new CredentialCipher('wrong-key').decrypt(encrypted)).toThrow(
      'PANEL_CREDENTIAL_DECRYPT_FAILED'
    );
  });

  it('fails closed for missing keys and malformed envelopes', () => {
    expect(() => new CredentialCipher('   ')).toThrow('PANEL_CREDENTIALS_KEY_MISSING');
    expect(() => new CredentialCipher('key').decrypt('plaintext')).toThrow(
      'PANEL_CREDENTIAL_ENVELOPE_INVALID'
    );
  });
});
