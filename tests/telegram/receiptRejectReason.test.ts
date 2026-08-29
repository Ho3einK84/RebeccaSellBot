import { describe, expect, it } from 'vitest';
import { FA_TEXTS } from '../../src/domain/services/TranslationCatalog.fa.js';
import { EN_TEXTS } from '../../src/domain/services/TranslationCatalog.en.js';
import type { ReceiptRejectReason } from '../../src/telegram/features/admin/receiptRoutes.js';

describe('Receipt Rejection Reasons & Localization', () => {
  const reasons: ReceiptRejectReason[] = [
    'unclear',
    'not_received',
    'duplicate',
    'amount_mismatch',
    'other',
  ];

  it('has all rejection reason keys in both FA and EN catalogs', () => {
    for (const r of reasons) {
      const adminKey = `admin_receipt_reject_reason_${r}`;
      const userKey = `receipt_result_rejected_reason_${r}`;

      expect(FA_TEXTS[adminKey], `Missing FA key ${adminKey}`).toBeDefined();
      expect(EN_TEXTS[adminKey], `Missing EN key ${adminKey}`).toBeDefined();

      expect(FA_TEXTS[userKey], `Missing FA key ${userKey}`).toBeDefined();
      expect(EN_TEXTS[userKey], `Missing EN key ${userKey}`).toBeDefined();
    }

    expect(FA_TEXTS['admin_receipt_reject_select_reason']).toBeDefined();
    expect(EN_TEXTS['admin_receipt_reject_select_reason']).toBeDefined();

    expect(FA_TEXTS['receipt_result_rejected_reason_label']).toBeDefined();
    expect(EN_TEXTS['receipt_result_rejected_reason_label']).toBeDefined();
  });

  it('generates compact callback data well under Telegram 64-byte limit', () => {
    const sampleReceiptId = 'rcpt_1788024579794_abcdef';
    const page = 1;

    for (const r of reasons) {
      const callback = `rcpt:rej:${sampleReceiptId}:${page}:${r}`;
      const byteLength = Buffer.byteLength(callback, 'utf8');

      expect(byteLength).toBeLessThanOrEqual(64);
    }
  });
});
