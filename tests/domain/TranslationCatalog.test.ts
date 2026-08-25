import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { FA_TEXTS } from '../../src/domain/services/TranslationCatalog.fa.js';
import { EN_TEXTS } from '../../src/domain/services/TranslationCatalog.en.js';
import { CONFIGURATION_DEFAULTS } from '../../src/domain/services/TranslationCatalog.js';

const SOURCE_ROOT = resolve(process.cwd(), 'src');
const CATALOG_PATHS = new Set([
  resolve(SOURCE_ROOT, 'domain/services/TranslationCatalog.fa.ts'),
  resolve(SOURCE_ROOT, 'domain/services/TranslationCatalog.en.ts'),
]);

const DYNAMIC_TRANSLATION_KEYS = [
  {
    generator: '`package_${packageId}_name`',
    pattern: /^package_(pkg_10gb_30d|pkg_30gb_30d|pkg_50gb_30d|pkg_100gb_60d)_name$/u,
  },
  {
    generator: '`subscription_state_${status}`',
    pattern: /^subscription_state_(active|disabled|on_hold|expired|depleted)$/u,
  },
  {
    generator: '`admin_broadcast_audience_${audience}`',
    pattern:
      /^admin_broadcast_audience_(active_subscription|no_subscription|no_purchase_30d|no_active_subscription)$/u,
  },
  {
    generator: '`admin_broadcast_status_${job.status}`',
    pattern: /^admin_broadcast_status_(queued|running|cancel_requested|cancelled|completed)$/u,
  },
  {
    generator: '`refund_reason_${result.reason}`',
    pattern:
      /^refund_reason_(config_not_found|remote_unavailable|already_used|not_purchased_here|ownership_mismatch|renewed_service|refund_window_expired|referral_reward_attached|already_refunded|refund_in_progress)$/u,
  },
  {
    generator: '`admin_panel_credential_${panel.credentialMode}`',
    pattern: /^admin_panel_credential_(api_key|password|none)$/u,
  },
] as const;

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

function collectProductionStringLiterals(): {
  literals: Set<string>;
  sourceText: string;
} {
  const literals = new Set<string>();
  let sourceText = '';

  for (const path of listTypeScriptFiles(SOURCE_ROOT)) {
    if (CATALOG_PATHS.has(resolve(path))) continue;
    const fileText = readFileSync(path, 'utf8');
    sourceText += fileText;
    const source = ts.createSourceFile(path, fileText, ts.ScriptTarget.Latest, true);

    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteralLike(node)) literals.add(node.text);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  return { literals, sourceText };
}

describe('Translation Catalog Parity and Standard', () => {
  it('uses the intended default top-up range and card-holder name', () => {
    expect(CONFIGURATION_DEFAULTS.card_holder).toBe('Name');
    expect(CONFIGURATION_DEFAULTS.topup_min_amount).toBe('10000');
    expect(CONFIGURATION_DEFAULTS.topup_max_amount).toBe('10000000');
  });

  it('has identical key sets in Persian and English catalogs', () => {
    const faKeys = Object.keys(FA_TEXTS).sort();
    const enKeys = Object.keys(EN_TEXTS).sort();

    expect(faKeys).toEqual(enKeys);
    expect(faKeys.length).toBe(Object.keys(EN_TEXTS).length);
  });

  it('contains no missing ZWNJ errors in Persian catalog for common compound patterns', () => {
    const forbiddenPatterns = [
      /میتوانید/,
      /میتواند/,
      /میتوان\b/,
      /میباشد/,
      /می‌باشد/,
      /پیشنمایش/,
      /سرویسهای/,
      /سرویسها\b/,
      /پنلهای/,
      /پنلها\b/,
      /اشتراکهای/,
      /اشتراکها\b/,
      /بستههای/,
      /بسته های/,
      /حسابهای/,
      /گزینههای/,
      /بخشهای/,
      /نامگذاری/,
      /معرفیشده/,
      /امکانپذیر/,
      /فعالسازی/,
      /بروزرسانی/,
      /دسته بندی/,
      /کسر نگردید/,
      /ذخیره نگردید/,
      /واریز نموده/,
      /مدیریت نموده/,
    ];

    const errors: string[] = [];

    for (const [key, text] of Object.entries(FA_TEXTS)) {
      for (const pattern of forbiddenPatterns) {
        if (pattern.test(text)) {
          errors.push(`Key "${key}" failed pattern ${pattern}: "${text}"`);
        }
      }
    }

    expect(errors).toEqual([]);
  });

  it('ensures parameter placeholders match between Persian and English entries', () => {
    const placeholderRegex = /\{([a-zA-Z0-9_]+)\}/g;

    for (const key of Object.keys(FA_TEXTS)) {
      const faText = FA_TEXTS[key] ?? '';
      const enText = EN_TEXTS[key] ?? '';

      const faMatches = new Set([...faText.matchAll(placeholderRegex)].map((m) => m[1]));
      const enMatches = new Set([...enText.matchAll(placeholderRegex)].map((m) => m[1]));

      expect(faMatches, `Placeholder mismatch on key "${key}"`).toEqual(enMatches);
    }
  });

  it('contains no entries unused by production source', () => {
    const { literals, sourceText } = collectProductionStringLiterals();

    for (const { generator } of DYNAMIC_TRANSLATION_KEYS) {
      expect(sourceText, `Missing dynamic translation lookup ${generator}`).toContain(generator);
    }

    const unusedKeys = Object.keys(FA_TEXTS).filter(
      (key) =>
        !literals.has(key) && !DYNAMIC_TRANSLATION_KEYS.some(({ pattern }) => pattern.test(key))
    );

    expect(unusedKeys, 'Catalog entries must be referenced by production source').toEqual([]);
  });

  it('guarantees 100% of catalog keys are covered by TEXT_CATEGORIES', async () => {
    const { TEXT_CATEGORIES } =
      await import('../../src/telegram/conversations/adminConversations/texts.js');
    const faKeys = Object.keys(FA_TEXTS);

    const uncategorized = faKeys.filter((key) => !TEXT_CATEGORIES.some((c) => c.matches(key)));
    expect(uncategorized, 'All translation keys must be covered by TEXT_CATEGORIES').toEqual([]);
  });

  it('ensures all ESSENTIAL_USER_TEXTS exist in catalog', async () => {
    const { ESSENTIAL_USER_TEXTS } =
      await import('../../src/telegram/conversations/adminConversations/texts.js');
    for (const item of ESSENTIAL_USER_TEXTS) {
      expect(FA_TEXTS, `Essential text key "${item.key}" must exist`).toHaveProperty(item.key);
      expect(FA_TEXTS, `Essential labelKey "${item.labelKey}" must exist`).toHaveProperty(
        item.labelKey
      );
      expect(FA_TEXTS, `Essential descKey "${item.descKey}" must exist`).toHaveProperty(
        item.descKey
      );
    }
  });
});
