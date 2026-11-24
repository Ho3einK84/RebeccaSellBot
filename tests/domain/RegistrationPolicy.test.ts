import { describe, expect, it, vi } from 'vitest';
import {
  evaluateRegistrationAccess,
  extractStartReferralCode,
  resolveRegistrationBlockedCopy,
} from '../../src/domain/services/RegistrationPolicy.js';
import {
  DEFAULT_REGISTRATION_MODE,
  REGISTRATION_MODES,
  parseRegistrationMode,
  registrationMode,
} from '../../src/domain/services/FeatureSettings.js';
import { TranslationService } from '../../src/domain/services/TranslationService.js';
import { validateAdminSetting } from '../../src/telegram/conversations/adminConversations/settings/validation.js';

function settingsReader(modeValue?: string) {
  return {
    getSetting: vi.fn((key: string, fallback = '') =>
      key === 'registration_mode' && modeValue !== undefined ? modeValue : fallback
    ),
  };
}

describe('RegistrationPolicy & registration_mode settings', () => {
  it('normalizes registration_mode setting values with safe default "open"', () => {
    expect(DEFAULT_REGISTRATION_MODE).toBe('open');
    expect(REGISTRATION_MODES).toEqual(['open', 'invite_only', 'closed']);
    expect(parseRegistrationMode(undefined)).toBe('open');
    expect(parseRegistrationMode('')).toBe('open');
    expect(parseRegistrationMode('unknown')).toBe('open');
    expect(parseRegistrationMode('OPEN')).toBe('open');
    expect(parseRegistrationMode(' invite_only ')).toBe('invite_only');
    expect(parseRegistrationMode('CLOSED')).toBe('closed');

    expect(registrationMode(settingsReader('invite_only'))).toBe('invite_only');
    expect(registrationMode(settingsReader('closed'))).toBe('closed');
    expect(registrationMode(settingsReader('invalid'))).toBe('open');

    expect(validateAdminSetting('registration_mode', 'open')).toBe('open');
    expect(validateAdminSetting('registration_mode', 'INVITE_ONLY')).toBe('invite_only');
    expect(validateAdminSetting('registration_mode', 'closed')).toBe('closed');
    expect(validateAdminSetting('registration_mode', 'disabled')).toBeUndefined();
  });

  it('extracts referral codes cleanly from /start payloads and start_param tokens', () => {
    expect(extractStartReferralCode(undefined)).toBeUndefined();
    expect(extractStartReferralCode('/start')).toBeUndefined();
    expect(extractStartReferralCode('/start ref_abc123')).toBe('ref_abc123');
    expect(extractStartReferralCode('/start@MyBot ref_xyz789')).toBe('ref_xyz789');
    expect(extractStartReferralCode('/start other_payload')).toBeUndefined();
    expect(extractStartReferralCode('ref_webapp_1')).toBe('ref_webapp_1');
    expect(extractStartReferralCode('random_param')).toBeUndefined();
  });

  it('never blocks existing users or admins regardless of registration_mode', async () => {
    const resolveReferrerId = vi.fn().mockResolvedValue(undefined);
    for (const mode of ['open', 'invite_only', 'closed'] as const) {
      const existing = await evaluateRegistrationAccess({
        telegramId: 5001,
        isAdmin: false,
        userExists: true,
        settings: settingsReader(mode),
        referralService: { resolveReferrerId },
      });
      expect(existing).toMatchObject({
        allowed: true,
        mode,
        isExistingUser: true,
        isAdmin: false,
      });

      const admin = await evaluateRegistrationAccess({
        telegramId: 12345,
        isAdmin: true,
        userExists: false,
        settings: settingsReader(mode),
        referralService: { resolveReferrerId },
      });
      expect(admin).toMatchObject({
        allowed: true,
        mode,
        isExistingUser: false,
        isAdmin: true,
      });
    }
    expect(resolveReferrerId).not.toHaveBeenCalled();
  });

  it('blocks new non-admin users in closed mode', async () => {
    const resolveReferrerId = vi.fn().mockResolvedValue(999);
    const res = await evaluateRegistrationAccess({
      telegramId: 7777,
      isAdmin: false,
      userExists: false,
      settings: settingsReader('closed'),
      referralCode: 'ref_valid',
      referralService: { resolveReferrerId },
    });

    expect(res).toEqual({
      allowed: false,
      mode: 'closed',
      reason: 'closed',
      code: 'REGISTRATION_CLOSED',
    });
    expect(resolveReferrerId).not.toHaveBeenCalled();
  });

  it('enforces valid referral lookup in invite_only mode', async () => {
    const resolveReferrerId = vi.fn(async (code: string | undefined, recipientId: number) => {
      if (code === 'ref_valid' && recipientId !== 42) return 42;
      return undefined;
    });

    const missingCode = await evaluateRegistrationAccess({
      telegramId: 8001,
      isAdmin: false,
      userExists: false,
      settings: settingsReader('invite_only'),
      referralCode: undefined,
      referralService: { resolveReferrerId },
    });
    expect(missingCode).toEqual({
      allowed: false,
      mode: 'invite_only',
      reason: 'invite_only',
      code: 'REGISTRATION_INVITE_ONLY',
    });

    const invalidCode = await evaluateRegistrationAccess({
      telegramId: 8001,
      isAdmin: false,
      userExists: false,
      settings: settingsReader('invite_only'),
      referralCode: 'ref_bogus',
      referralService: { resolveReferrerId },
    });
    expect(invalidCode).toEqual({
      allowed: false,
      mode: 'invite_only',
      reason: 'invite_only',
      code: 'REGISTRATION_INVITE_ONLY',
    });

    // Self-referral check: resolveReferrerId returns undefined when candidate tries own ID
    const selfRef = await evaluateRegistrationAccess({
      telegramId: 42,
      isAdmin: false,
      userExists: false,
      settings: settingsReader('invite_only'),
      referralCode: 'ref_valid',
      referralService: { resolveReferrerId },
    });
    expect(selfRef).toEqual({
      allowed: false,
      mode: 'invite_only',
      reason: 'invite_only',
      code: 'REGISTRATION_INVITE_ONLY',
    });

    const invited = await evaluateRegistrationAccess({
      telegramId: 8001,
      isAdmin: false,
      userExists: false,
      settings: settingsReader('invite_only'),
      referralCode: 'ref_valid',
      referralService: { resolveReferrerId },
    });
    expect(invited).toEqual({
      allowed: true,
      mode: 'invite_only',
      isExistingUser: false,
      isAdmin: false,
      referrerId: 42,
    });
  });

  it('resolves customizable bilingual registration block messages in fa and en', async () => {
    const ts = new TranslationService();
    const closedFa = resolveRegistrationBlockedCopy(ts, 'fa', 'closed');
    const inviteEn = resolveRegistrationBlockedCopy(ts, 'en', 'invite_only');

    expect(closedFa.title).toContain('ثبت‌نام');
    expect(closedFa.message.length).toBeGreaterThan(10);
    expect(closedFa.alert.length).toBeGreaterThan(5);
    expect(inviteEn.title).toContain('Invite');
    expect(inviteEn.message).toContain('referral');
  });
});
