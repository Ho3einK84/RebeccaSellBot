import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { CredentialCipher } from '../../src/infra/CredentialCipher.js';
import { createLogger, safeError } from '../../src/infra/logger.js';

describe('CredentialCipher — AES-256-GCM envelope integrity and error handling', () => {
  it('round-trips secrets without storing plaintext and uses a fresh nonce per call', () => {
    const cipher = new CredentialCipher('super-strong-deployment-key-material-32bytes');
    const plaintext = 'rebecca_live_api_key_value';
    const first = cipher.encrypt(plaintext);
    const second = cipher.encrypt(plaintext);

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toContain(plaintext);
    expect(first).not.toBe(second);
    expect(cipher.decrypt(first)).toBe(plaintext);
    expect(cipher.decrypt(second)).toBe(plaintext);
  });

  it('rejects ciphertext tampering, wrong deployment keys, and empty keys', () => {
    expect(() => new CredentialCipher('   ')).toThrow('PANEL_CREDENTIALS_KEY_MISSING');

    const cipherA = new CredentialCipher('deployment-key-alpha-0123456789');
    const cipherB = new CredentialCipher('deployment-key-beta-0123456789');
    const encrypted = cipherA.encrypt('admin-password-xyz')!;

    expect(() => cipherB.decrypt(encrypted)).toThrow('PANEL_CREDENTIAL_DECRYPT_FAILED');

    const parts = encrypted.split(':');
    const tamperedData = Buffer.from(parts[3]!, 'base64url');
    tamperedData[0] = (tamperedData[0]! ^ 0xff) & 0xff;
    parts[3] = tamperedData.toString('base64url');
    expect(() => cipherA.decrypt(parts.join(':'))).toThrow('PANEL_CREDENTIAL_DECRYPT_FAILED');
  });

  it('rejects short GCM auth tags (< 16 bytes) and non-12-byte IVs explicitly', () => {
    const cipher = new CredentialCipher('deployment-key-strict-0123456789');
    const valid = cipher.encrypt('secret-token')!.split(':');

    // Truncate 16-byte tag down to 4 bytes
    const shortTag = Buffer.from(valid[2]!, 'base64url').subarray(0, 4).toString('base64url');
    expect(() => cipher.decrypt([valid[0], valid[1], shortTag, valid[3]].join(':'))).toThrow(
      'PANEL_CREDENTIAL_ENVELOPE_INVALID'
    );

    // Truncate 12-byte IV down to 8 bytes
    const shortIv = Buffer.from(valid[1]!, 'base64url').subarray(0, 8).toString('base64url');
    expect(() => cipher.decrypt([valid[0], shortIv, valid[2], valid[3]].join(':'))).toThrow(
      'PANEL_CREDENTIAL_ENVELOPE_INVALID'
    );

    expect(() => cipher.decrypt('invalid-format')).toThrow('PANEL_CREDENTIAL_ENVELOPE_INVALID');
    expect(cipher.encrypt(undefined)).toBeNull();
    expect(cipher.decrypt(null)).toBeUndefined();
  });
});

describe('logger & safeError — Pino redaction and structured error sanitization', () => {
  it('redacts configured secrets, cookies, and webhook headers in real Pino JSON output', () => {
    const chunks: string[] = [];
    const stream = new PassThrough();
    stream.on('data', (chunk: Buffer) => chunks.push(chunk.toString('utf8')));

    const testLogger = createLogger(stream);
    testLogger.info(
      {
        BOT_TOKEN: 'bot-secret-value',
        REBECCA_API_KEY: 'api-secret-value',
        REBECCA_ADMIN_PASSWORD: 'admin-password-value',
        PANEL_CREDENTIALS_KEY: 'panel-key-value',
        ADMIN_SESSION_SECRET: 'admin-session-secret-value',
        WEBAPP_SESSION_SECRET: 'webapp-session-secret-value',
        WEBHOOK_SECRET_TOKEN: 'webhook-token-value',
        REBECCA_WEBHOOK_SECRET: 'rebecca-webhook-secret-value',
        secret: 'top-level-secret',
        photoFileId: 'AgACAgIAAxkBA',
        nested: {
          secret: 'nested-secret',
          apiKey: 'nested-api-key',
          token: 'nested-token',
        },
        headers: {
          authorization: 'Bearer secret-jwt',
          cookie: 'rsbot_session=secret',
          'x-api-key': 'header-key',
          'x-telegram-bot-api-secret-token': 'tg-secret',
          'x-webhook-secret': 'wh-secret',
        },
        safeField: 'visible-value',
      },
      'audit-event'
    );

    const parsed = JSON.parse(chunks.join('').trim()) as Record<string, unknown>;
    expect(parsed.BOT_TOKEN).toBe('[REDACTED]');
    expect(parsed.REBECCA_API_KEY).toBe('[REDACTED]');
    expect(parsed.REBECCA_ADMIN_PASSWORD).toBe('[REDACTED]');
    expect(parsed.PANEL_CREDENTIALS_KEY).toBe('[REDACTED]');
    expect(parsed.ADMIN_SESSION_SECRET).toBe('[REDACTED]');
    expect(parsed.WEBAPP_SESSION_SECRET).toBe('[REDACTED]');
    expect(parsed.WEBHOOK_SECRET_TOKEN).toBe('[REDACTED]');
    expect(parsed.REBECCA_WEBHOOK_SECRET).toBe('[REDACTED]');
    expect(parsed.secret).toBe('[REDACTED]');
    expect(parsed.photoFileId).toBe('[REDACTED]');
    expect((parsed.nested as Record<string, unknown>).secret).toBe('[REDACTED]');
    expect((parsed.nested as Record<string, unknown>).apiKey).toBe('[REDACTED]');
    expect((parsed.nested as Record<string, unknown>).token).toBe('[REDACTED]');
    expect((parsed.headers as Record<string, unknown>).authorization).toBe('[REDACTED]');
    expect((parsed.headers as Record<string, unknown>).cookie).toBe('[REDACTED]');
    expect((parsed.headers as Record<string, unknown>)['x-webhook-secret']).toBe('[REDACTED]');
    expect(parsed.safeField).toBe('visible-value');
  });

  it('serializes Error metadata safely without leaking arbitrary message text', () => {
    const err = Object.assign(new TypeError('postgres://user:password@host/db failed'), {
      code: 'ECONNREFUSED',
      status: 503,
      issueCount: 2,
    });
    const serialized = safeError(err);
    expect(serialized).toEqual({
      name: 'TypeError',
      code: 'ECONNREFUSED',
      status: 503,
      issueCount: 2,
    });
    expect(JSON.stringify(serialized)).not.toContain('password');
    expect(safeError({ message: 'plain object' })).toEqual({ type: 'object' });
  });
});
