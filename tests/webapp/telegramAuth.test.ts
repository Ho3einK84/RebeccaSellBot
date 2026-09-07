import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateTelegramInitData } from '../../src/webapp/server/auth.js';

function createSignedInitData(
  fields: Record<string, string>,
  botToken: string,
  tamperHash = false
): string {
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const sortedKeys = Object.keys(fields).sort();
  const dataCheckString = sortedKeys.map((k) => `${k}=${fields[k]}`).join('\n');

  let hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (tamperHash) {
    hash = hash.slice(0, -2) + (hash.endsWith('a') ? 'b' : 'a');
  }

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    params.set(k, v);
  }
  params.set('hash', hash);

  return params.toString();
}

describe('validateTelegramInitData', () => {
  const testBotToken = '123456789:ABCDefghIJKLmnOPqrstUVwxyz';
  const validUser = {
    id: 987654321,
    first_name: 'Test',
    last_name: 'Admin',
    username: 'testadmin',
  };

  it('validates authentic and fresh initData correctly', () => {
    const now = Math.floor(Date.now() / 1000);
    const rawInitData = createSignedInitData(
      {
        auth_date: String(now - 60), // 1 minute ago
        query_id: 'AAHdF6IQAAAAAN0XohD_xxxx',
        user: JSON.stringify(validUser),
      },
      testBotToken
    );

    const result = validateTelegramInitData(rawInitData, testBotToken);
    expect(result).not.toBeNull();
    expect(result?.user.id).toBe(987654321);
    expect(result?.user.username).toBe('testadmin');
    expect(result?.authDate).toBe(now - 60);
    expect(result?.queryId).toBe('AAHdF6IQAAAAAN0XohD_xxxx');
  });

  it('rejects tampered hash with timingSafeEqual', () => {
    const now = Math.floor(Date.now() / 1000);
    const rawInitData = createSignedInitData(
      {
        auth_date: String(now),
        user: JSON.stringify(validUser),
      },
      testBotToken,
      true // tamper the hash
    );

    const result = validateTelegramInitData(rawInitData, testBotToken);
    expect(result).toBeNull();
  });

  it('rejects tampered payload fields', () => {
    const now = Math.floor(Date.now() / 1000);
    const rawInitData = createSignedInitData(
      {
        auth_date: String(now),
        user: JSON.stringify(validUser),
      },
      testBotToken
    );

    // Tamper the payload after signing
    const tampered = rawInitData.replace('987654321', '111111111');
    const result = validateTelegramInitData(tampered, testBotToken);
    expect(result).toBeNull();
  });

  it('rejects expired auth_date (older than 24 hours)', () => {
    const now = Math.floor(Date.now() / 1000);
    const rawInitData = createSignedInitData(
      {
        auth_date: String(now - 86_500), // > 24 hours ago
        user: JSON.stringify(validUser),
      },
      testBotToken
    );

    const result = validateTelegramInitData(rawInitData, testBotToken);
    expect(result).toBeNull();
  });

  it('rejects future auth_date (> 5 minutes in future)', () => {
    const now = Math.floor(Date.now() / 1000);
    const rawInitData = createSignedInitData(
      {
        auth_date: String(now + 600), // 10 minutes in future
        user: JSON.stringify(validUser),
      },
      testBotToken
    );

    const result = validateTelegramInitData(rawInitData, testBotToken);
    expect(result).toBeNull();
  });

  it('rejects missing hash, empty string, or malformed user JSON', () => {
    expect(validateTelegramInitData('', testBotToken)).toBeNull();
    expect(validateTelegramInitData('auth_date=123456&user={}', testBotToken)).toBeNull();
    expect(
      validateTelegramInitData(
        createSignedInitData(
          {
            auth_date: String(Math.floor(Date.now() / 1000)),
            user: 'not-valid-json',
          },
          testBotToken
        ),
        testBotToken
      )
    ).toBeNull();
  });
});
