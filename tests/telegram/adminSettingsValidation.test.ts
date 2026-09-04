import { describe, expect, it } from 'vitest';
import {
  isValidNamingTemplate,
  normalizeSupportDestination,
  validateAdminSetting,
} from '../../src/telegram/conversations/adminConversations.js';

describe('admin settings validation', () => {
  it('canonicalizes Persian and Arabic digits, decimal separators, and grouping', () => {
    expect(validateAdminSetting('low_traffic_threshold_gb', ' ۱۲٫۵ ')).toBe('12.5');
    expect(validateAdminSetting('low_traffic_threshold_gb', '١٬٢٣٤٫٥')).toBe('1234.5');
    expect(validateAdminSetting('expiry_warning_days', '۳۶۵')).toBe('365');
    expect(validateAdminSetting('referral_bonus_toman', '۱٬۰۰۰٬۰۰۰')).toBe('1000000');
  });

  it('enforces zero semantics, integer requirements, ranges, and safe-number bounds', () => {
    expect(validateAdminSetting('expiry_warning_days', '۰')).toBe('0');
    expect(validateAdminSetting('refund_window_hours', '0')).toBe('0');
    expect(validateAdminSetting('cashback_percent', '0')).toBe('0');
    expect(validateAdminSetting('trial_gb', '0')).toBeUndefined();
    expect(validateAdminSetting('price_per_gb', '-1')).toBeUndefined();
    expect(validateAdminSetting('trial_days', '1.5')).toBeUndefined();
    expect(validateAdminSetting('cashback_percent', '101')).toBeUndefined();
    expect(validateAdminSetting('price_per_gb', 'Infinity')).toBeUndefined();
    expect(validateAdminSetting('price_per_gb', 'NaN')).toBeUndefined();
    expect(validateAdminSetting('price_per_gb', '9007199254740992')).toBeUndefined();
    expect(validateAdminSetting('wallet_transfer_min_amount', '5000')).toBe('5000');
    expect(validateAdminSetting('wallet_transfer_min_amount', '۵٬۰۰۰')).toBe('5000');
    expect(validateAdminSetting('wallet_transfer_min_amount', '0')).toBeUndefined();
  });

  it('normalizes card numbers without retaining presentation separators', () => {
    expect(validateAdminSetting('card_number', '۶۰۳۷-۹۹۱۲-۳۴۵۶-۷۸۹۰')).toBe('6037991234567890');
    expect(validateAdminSetting('card_number', '6037 9912 3456')).toBe('603799123456');
    expect(validateAdminSetting('card_number', '1234')).toBeUndefined();
    expect(validateAdminSetting('card_number', '6037x991234567890')).toBeUndefined();
  });

  it('supports canonical Telegram usernames, numeric chat IDs, and explicit removal', () => {
    expect(normalizeSupportDestination('support_team')).toBe('@support_team');
    expect(normalizeSupportDestination(' @support_team ')).toBe('@support_team');
    expect(normalizeSupportDestination('۱۲۳۴۵۶۷۸۹')).toBe('123456789');
    expect(normalizeSupportDestination('-1001234567890')).toBe('-1001234567890');
    expect(normalizeSupportDestination('-۱۰۰۱۲۳۴۵۶۷۸۹۰')).toBe('-1001234567890');
    expect(normalizeSupportDestination('')).toBe('');
    expect(normalizeSupportDestination('@bad')).toBeUndefined();
    expect(normalizeSupportDestination('https://t.me/support_team')).toBeUndefined();
  });

  it('accepts only known naming tokens and compatible identifier characters', () => {
    expect(validateAdminSetting('naming_prefix', ' Rebecca_2 ')).toBe('Rebecca_2');
    expect(validateAdminSetting('naming_prefix', '_hidden')).toBeUndefined();
    expect(isValidNamingTemplate('{prefix}_{telegram_id}_{counter}')).toBe(true);
    expect(isValidNamingTemplate('{prefix}_{year}_{month}_{counter}')).toBe(true);
    expect(isValidNamingTemplate('{prefix}_{yy}{month}_{counter}')).toBe(true);
    expect(isValidNamingTemplate('{prefix}_{jyear}_{jmonth}_{day}_{counter}')).toBe(true);
    expect(
      isValidNamingTemplate('{prefix}_{jalali_year}_{jalali_month}_{jalali_day}_{counter}')
    ).toBe(true);
    expect(isValidNamingTemplate('{prefix}-{random4}.user')).toBe(true);
    expect(isValidNamingTemplate('{unknown}_{counter}')).toBe(false);
    expect(isValidNamingTemplate('{prefix}_{counter}!')).toBe(false);
    expect(isValidNamingTemplate('{}')).toBe(false);
  });

  it('rejects malformed or empty package collections', () => {
    expect(validateAdminSetting('packages_json', '[]')).toBeUndefined();
    expect(validateAdminSetting('packages_json', '{not json}')).toBeUndefined();
    expect(
      validateAdminSetting(
        'packages_json',
        JSON.stringify([
          { id: 'starter', name: 'Starter', gbAmount: 10, durationDays: 30, price: 50_000 },
        ])
      )
    ).toBe('[{"id":"starter","name":"Starter","gbAmount":10,"durationDays":30,"price":50000}]');
  });
});
