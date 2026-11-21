import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getDb } from '../../src/infra/db.js';
import { catalogDiscounts, users, type CatalogDiscountRow } from '../../src/infra/schema.js';
import {
  CatalogDiscountService,
  resolveBestCatalogDiscount,
  type CatalogDiscountRule,
} from '../../src/domain/services/CatalogDiscountService.js';
import {
  ContactVerificationService,
  computePhoneHash,
  isIranPhoneNumber,
  normalizePhoneNumber,
} from '../../src/domain/services/ContactVerificationService.js';
import {
  PricingService,
  formatRemainingDiscountDuration,
  type PackageOption,
} from '../../src/domain/services/PricingService.js';
import { TranslationService } from '../../src/domain/services/TranslationService.js';
import {
  buildCustomCheckoutScreen,
  verifyPhoneConversation,
} from '../../src/telegram/conversations/userConversations.js';
import { adminCatalogDiscountsConversation } from '../../src/telegram/conversations/adminConversations/catalogDiscounts.js';
import { registerBaseRoutes } from '../../src/telegram/features/baseRoutes.js';
import {
  buildPurchaseCheckoutScreen,
  renderShopMenuText,
  renderWalletStatementScreen,
} from '../../src/telegram/keyboards/mainMenu.js';
import { isAdminCallbackData } from '../../src/telegram/botRuntime.js';
import { resetActionCooldowns } from '../../src/telegram/middleware/actionCooldown.js';
import type { ConversationContext, MenuContext, MyConversation } from '../../src/telegram/types.js';
import { createWebAppServer } from '../../src/webapp/server/server.js';
import { createMockDb, pgUniqueViolationError } from './_helpers/mockDb.js';
import { createBotHarness, createMockServices } from '../telegram/helpers/botHarness.js';
import { createMockUserServices, createTestConfig } from '../webapp/helpers/webappTestHarness.js';

vi.mock('../../src/infra/db.js', () => ({ getDb: vi.fn() }));
vi.mock('../../src/infra/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

const getDbMock = vi.mocked(getDb);

function makeDiscount(overrides: Partial<CatalogDiscountRule> = {}): CatalogDiscountRule {
  return {
    id: 'disc_base',
    title: 'Flash Sale',
    scope: 'all',
    targetId: null,
    discountType: 'percent',
    value: 20,
    maxDiscountAmount: null,
    startsAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: new Date('2026-12-31T23:59:59Z'),
    active: true,
    ...overrides,
  };
}

function makeSettings(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries));
  return {
    getSetting: vi.fn((key: string, fallback = '') => map.get(key) ?? fallback),
    getSettingNum: vi.fn((key: string, fallback = 0) => {
      const val = map.get(key);
      if (val === undefined || val === '') return fallback;
      const n = Number(val);
      return Number.isFinite(n) ? n : fallback;
    }),
    getSettingBool: vi.fn((key: string, fallback = false) => {
      const val = map.get(key);
      if (val === undefined) return fallback;
      return val === 'true' || val === '1';
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  resetActionCooldowns();
  vi.useRealTimers();
});

describe('CatalogDiscountService & resolveBestCatalogDiscount', () => {
  const now = new Date('2026-06-15T12:00:00Z');

  it('matches all, category, and package scopes accurately', () => {
    const discounts: CatalogDiscountRule[] = [
      makeDiscount({ id: 'd_all', title: 'Sitewide 10%', scope: 'all', value: 10 }),
      makeDiscount({
        id: 'd_cat',
        title: 'VIP Category 25%',
        scope: 'category',
        targetId: 'cat_vip',
        value: 25,
      }),
      makeDiscount({
        id: 'd_pkg',
        title: 'Hero Pkg 40%',
        scope: 'package',
        targetId: 'pkg_50gb_30d',
        value: 40,
      }),
    ];

    const general = resolveBestCatalogDiscount(
      discounts,
      { packageId: 'pkg_10gb_30d', categoryId: 'cat_basic', originalPrice: 100_000 },
      now
    );
    expect(general.activeDiscountId).toBe('d_all');
    expect(general.discountAmount).toBe(10_000);
    expect(general.effectivePrice).toBe(90_000);

    const catMatch = resolveBestCatalogDiscount(
      discounts,
      { packageId: 'pkg_30gb_30d', categoryId: 'cat_vip', originalPrice: 100_000 },
      now
    );
    expect(catMatch.activeDiscountId).toBe('d_cat');
    expect(catMatch.discountAmount).toBe(25_000);
    expect(catMatch.effectivePrice).toBe(75_000);

    const pkgMatch = resolveBestCatalogDiscount(
      discounts,
      { packageId: 'pkg_50gb_30d', categoryId: 'cat_vip', originalPrice: 100_000 },
      now
    );
    expect(pkgMatch.activeDiscountId).toBe('d_pkg');
    expect(pkgMatch.discountAmount).toBe(40_000);
    expect(pkgMatch.effectivePrice).toBe(60_000);
  });

  it('caps percent discounts with maxDiscountAmount and clamps fixed discounts at 0', () => {
    const percentCapped = resolveBestCatalogDiscount(
      [
        makeDiscount({
          id: 'd_cap',
          title: '50% up to 30k',
          discountType: 'percent',
          value: 50,
          maxDiscountAmount: 30_000,
        }),
      ],
      { packageId: 'pkg_1', originalPrice: 200_000 },
      now
    );
    expect(percentCapped.discountAmount).toBe(30_000);
    expect(percentCapped.effectivePrice).toBe(170_000);

    const fixedFloor = resolveBestCatalogDiscount(
      [
        makeDiscount({
          id: 'd_fix',
          title: 'Huge Fixed Off',
          discountType: 'fixed',
          value: 500_000,
        }),
      ],
      { packageId: 'pkg_1', originalPrice: 80_000 },
      now
    );
    expect(fixedFloor.discountAmount).toBe(80_000);
    expect(fixedFloor.effectivePrice).toBe(0);
  });

  it('selects best savings and breaks ties by specificity (package > category > all) then earliest expiry', () => {
    const tieBySpecificity = resolveBestCatalogDiscount(
      [
        makeDiscount({ id: 'd_all', scope: 'all', discountType: 'fixed', value: 20_000 }),
        makeDiscount({
          id: 'd_cat',
          scope: 'category',
          targetId: 'cat_1',
          discountType: 'fixed',
          value: 20_000,
        }),
        makeDiscount({
          id: 'd_pkg',
          scope: 'package',
          targetId: 'pkg_1',
          discountType: 'fixed',
          value: 20_000,
        }),
      ],
      { packageId: 'pkg_1', categoryId: 'cat_1', originalPrice: 100_000 },
      now
    );
    expect(tieBySpecificity.activeDiscountId).toBe('d_pkg');

    const tieByExpiry = resolveBestCatalogDiscount(
      [
        makeDiscount({
          id: 'd_later',
          scope: 'all',
          discountType: 'percent',
          value: 20,
          expiresAt: new Date('2026-08-01T00:00:00Z'),
        }),
        makeDiscount({
          id: 'd_sooner',
          scope: 'all',
          discountType: 'percent',
          value: 20,
          expiresAt: new Date('2026-06-20T00:00:00Z'),
        }),
      ],
      { packageId: 'pkg_1', originalPrice: 100_000 },
      now
    );
    expect(tieByExpiry.activeDiscountId).toBe('d_sooner');
  });

  it('filters out inactive, not-yet-started, and expired discounts while allowing null expiry', () => {
    const discounts: CatalogDiscountRule[] = [
      makeDiscount({ id: 'd_inactive', active: false, value: 90 }),
      makeDiscount({
        id: 'd_future',
        startsAt: new Date('2026-07-01T00:00:00Z'),
        value: 80,
      }),
      makeDiscount({
        id: 'd_expired',
        expiresAt: new Date('2026-06-15T12:00:00Z'), // expiresAt === now -> expired
        value: 70,
      }),
      makeDiscount({
        id: 'd_open',
        title: 'Evergreen 15%',
        expiresAt: null,
        value: 15,
      }),
    ];

    const resolved = resolveBestCatalogDiscount(
      discounts,
      { packageId: 'pkg_1', originalPrice: 100_000 },
      now
    );
    expect(resolved.activeDiscountId).toBe('d_open');
    expect(resolved.activeDiscountTitle).toBe('Evergreen 15%');
    expect(resolved.discountExpiresAt).toBeNull();
    expect(resolved.effectivePrice).toBe(85_000);
  });

  it('performs CRUD operations and validates inputs via CatalogDiscountService', async () => {
    const row: CatalogDiscountRow = {
      id: 'disc_1',
      title: 'Norooz Sale',
      scope: 'all',
      targetId: null,
      discountType: 'percent',
      value: 25,
      maxDiscountAmount: 50_000,
      startsAt: new Date('2026-06-01T00:00:00Z'),
      expiresAt: new Date('2026-07-01T00:00:00Z'),
      active: true,
      createdAt: new Date('2026-06-01T00:00:00Z'),
    };
    const { db, state } = createMockDb({
      selectResults: [[row], [row]],
      returningResults: [[row], [{ ...row, active: false }], [{ id: 'disc_1' }]],
    });
    getDbMock.mockReturnValue(db as never);

    const service = new CatalogDiscountService();
    const created = await service.createDiscount({
      id: 'disc_1',
      title: 'Norooz Sale',
      scope: 'all',
      discountType: 'percent',
      value: 25,
      maxDiscountAmount: 50_000,
      startsAt: new Date('2026-06-01T00:00:00Z'),
      expiresAt: new Date('2026-07-01T00:00:00Z'),
    });
    expect(created.id).toBe('disc_1');
    expect(state.insertCalls[0]?.table).toBe(catalogDiscounts);

    const activeList = await service.listActiveDiscounts(now);
    expect(activeList).toHaveLength(1);

    const toggled = await service.toggleDiscount('disc_1');
    expect(toggled?.active).toBe(false);

    const deleted = await service.deleteDiscount('disc_1');
    expect(deleted).toBe(true);

    await expect(
      service.createDiscount({
        title: 'Bad Percent',
        scope: 'all',
        discountType: 'percent',
        value: 150,
      })
    ).rejects.toThrow('INVALID_DISCOUNT_VALUE');
  });
});

describe('PricingService integration & remaining duration formatting', () => {
  it('resolves discounted package and custom volume pricing while preserving sync APIs', async () => {
    const packages: PackageOption[] = [
      {
        id: 'pkg_30gb_30d',
        name: '30 GB - 30 Days',
        gbAmount: 30,
        durationDays: 30,
        price: 120_000,
        categoryId: 'cat_pro',
        enabled: true,
      },
    ];
    const ts = makeSettings({
      packages_json: JSON.stringify(packages),
      price_per_gb: '5000',
      price_per_day: '0',
    }) as unknown as TranslationService;

    const pricing = new PricingService(ts);
    const now = new Date('2026-06-15T12:00:00Z');
    const expiresAt = new Date('2026-06-16T15:30:00Z');
    const activeDiscounts: CatalogDiscountRow[] = [
      {
        id: 'disc_summer',
        title: 'Summer Flash',
        scope: 'all',
        targetId: null,
        discountType: 'percent',
        value: 25,
        maxDiscountAmount: 40_000,
        startsAt: new Date('2026-06-01T00:00:00Z'),
        expiresAt,
        active: true,
        createdAt: new Date('2026-06-01T00:00:00Z'),
      },
    ];
    const fakeDiscountService = {
      listActiveDiscounts: vi.fn().mockResolvedValue(activeDiscounts),
    };

    // Existing sync API remains untouched
    expect(pricing.getPackages()[0]?.price).toBe(120_000);
    expect(pricing.getCustomPriceQuote(20, 30).totalPrice).toBe(100_000);

    // Discount-aware package pricing
    const discountedPkgs = await pricing.getPackagesWithDiscounts(fakeDiscountService, { now });
    expect(discountedPkgs[0]).toMatchObject({
      id: 'pkg_30gb_30d',
      originalPrice: 120_000,
      effectivePrice: 90_000,
      discountAmount: 30_000,
      activeDiscountTitle: 'Summer Flash',
      discountExpiresAt: expiresAt,
    });

    // Discount-aware custom volume quote (50 GB = 250k -> 25% = 62.5k capped to 40k -> 210k)
    const customQuote = await pricing.quoteWithCatalogDiscount(50, 30, fakeDiscountService, now);
    expect(customQuote.originalPrice).toBe(250_000);
    expect(customQuote.discountAmount).toBe(40_000);
    expect(customQuote.effectivePrice).toBe(210_000);
    expect(customQuote.totalPrice).toBe(210_000);
    expect(customQuote.activeDiscountTitle).toBe('Summer Flash');
    expect(customQuote.discountExpiresAt).toEqual(expiresAt);

    // Remaining duration formatting (fa / en)
    expect(formatRemainingDiscountDuration(expiresAt, 'en', now)).toBe('1d 3h');
    expect(formatRemainingDiscountDuration(expiresAt, 'fa', now)).toContain('روز');
    expect(formatRemainingDiscountDuration(new Date(now.getTime() + 45 * 60_000), 'en', now)).toBe(
      '45m'
    );
    expect(formatRemainingDiscountDuration(null, 'en', now)).toBe('Limited time');
  });
});

describe('ContactVerificationService (HMAC-SHA256 & zero raw phone storage)', () => {
  it('normalizes Persian/Arabic digits, local 09..., 0098..., +98..., and international numbers', () => {
    expect(normalizePhoneNumber('۰۹۱۲۳۴۵۶۷۸۹')).toBe('+989123456789');
    expect(normalizePhoneNumber('٠٩١٢٣٤٥٦٧٨٩')).toBe('+989123456789');
    expect(normalizePhoneNumber('0912-345-6789')).toBe('+989123456789');
    expect(normalizePhoneNumber('0098 912 345 6789')).toBe('+989123456789');
    expect(normalizePhoneNumber('989123456789')).toBe('+989123456789');
    expect(normalizePhoneNumber('+98 (912) 345-6789')).toBe('+989123456789');
    expect(normalizePhoneNumber('+1 (415) 555-0199')).toBe('+14155550199');
    expect(normalizePhoneNumber('00447911123456')).toBe('+447911123456');

    expect(normalizePhoneNumber('')).toBeNull();
    expect(normalizePhoneNumber('12345')).toBeNull();
    expect(normalizePhoneNumber('abc9123456789')).toBeNull();
    expect(normalizePhoneNumber('+00989123456789')).toBeNull();

    expect(isIranPhoneNumber('+989123456789')).toBe(true);
    expect(isIranPhoneNumber('+14155550199')).toBe(false);
    expect(isIranPhoneNumber('+989123')).toBe(false);
  });

  it('computes deterministic keyed HMAC-SHA256 hashes without exposing raw phone digits', () => {
    const hash1 = computePhoneHash('+989123456789', 'token_a');
    const hash2 = computePhoneHash('+989123456789', 'token_a');
    const hashDifferentToken = computePhoneHash('+989123456789', 'token_b');
    const hashDifferentPhone = computePhoneHash('+989123456788', 'token_a');

    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hashDifferentToken);
    expect(hash1).not.toBe(hashDifferentPhone);
    expect(hash1).not.toContain('9123456789');
  });

  it('enforces Iran-only policy, rejects duplicate hashes across users, and NEVER stores raw phone', async () => {
    const settings = makeSettings({ phone_verify_iran_only: 'true' });
    const service = new ContactVerificationService({
      translationService: settings,
      botToken: '123456:secret_bot_token',
    });

    // Reject non-Iran number when iran_only is true
    const nonIran = await service.verifyAndBindPhone({
      telegramId: 101,
      rawPhoneNumber: '+14155550199',
    });
    expect(nonIran).toEqual({ ok: false, reason: 'iran_only' });

    // Bind valid Iranian number — verify ONLY phoneHash and phoneVerifiedAt are written
    const { db: bindDb, state: bindState } = createMockDb({ selectResults: [[]] });
    getDbMock.mockReturnValue(bindDb as never);
    const rawPhone = '09123456789';
    const bound = await service.verifyAndBindPhone({
      telegramId: 101,
      rawPhoneNumber: rawPhone,
    });
    const expectedHash = computePhoneHash('+989123456789', '123456:secret_bot_token');
    expect(bound).toEqual({ ok: true, phoneHash: expectedHash, alreadyVerified: false });

    expect(bindState.updateCalls).toHaveLength(1);
    const updatePayload = bindState.updateCalls[0]!;
    expect(updatePayload.table).toBe(users);
    expect(updatePayload.set.phoneHash).toBe(expectedHash);
    expect(updatePayload.set.phoneVerifiedAt).toBeInstanceOf(Date);
    expect(Object.keys(updatePayload.set).sort()).toEqual([
      'phoneHash',
      'phoneVerifiedAt',
      'updatedAt',
    ]);
    expect(JSON.stringify(updatePayload.set)).not.toContain('9123456789');

    // Reject same phone bound to a different Telegram account
    const { db: dupDb } = createMockDb({
      selectResults: [[{ telegramId: 101, phoneVerifiedAt: new Date() }]],
    });
    getDbMock.mockReturnValue(dupDb as never);
    const duplicate = await service.verifyAndBindPhone({
      telegramId: 202,
      rawPhoneNumber: '+989123456789',
    });
    expect(duplicate).toEqual({ ok: false, reason: 'already_bound' });

    // Idempotent success for the same user
    const { db: sameUserDb, state: sameUserState } = createMockDb({
      selectResults: [[{ telegramId: 101, phoneVerifiedAt: new Date() }]],
    });
    getDbMock.mockReturnValue(sameUserDb as never);
    const idempotent = await service.verifyAndBindPhone({
      telegramId: 101,
      rawPhoneNumber: '۰۹۱۲۳۴۵۶۷۸۹',
    });
    expect(idempotent).toEqual({ ok: true, phoneHash: expectedHash, alreadyVerified: true });
    expect(sameUserState.updateCalls).toHaveLength(0);

    // Concurrent race unique violation maps to already_bound
    const { db: raceDb } = createMockDb({
      selectResults: [[]],
      updateError: pgUniqueViolationError('users_phone_hash_unique'),
    });
    getDbMock.mockReturnValue(raceDb as never);
    const raced = await service.verifyAndBindPhone({
      telegramId: 303,
      rawPhoneNumber: '+989123456789',
    });
    expect(raced).toEqual({ ok: false, reason: 'already_bound' });
  });

  it('evaluates trial and purchase phone gate requirements accurately', async () => {
    const disabledSettings = makeSettings({
      require_phone_for_trial: 'false',
      require_phone_for_purchase: 'false',
    });
    const disabledService = new ContactVerificationService({
      translationService: disabledSettings,
      botToken: '123456:token',
    });
    // Does not hit DB when disabled
    expect(await disabledService.shouldRequirePhoneForTrial(500)).toBe(false);
    expect(await disabledService.shouldRequirePhoneForPurchase(500)).toBe(false);
    expect(getDbMock).not.toHaveBeenCalled();

    const enabledSettings = makeSettings({
      require_phone_for_trial: 'true',
      require_phone_for_purchase: 'true',
    });
    const enabledService = new ContactVerificationService({
      translationService: enabledSettings,
      botToken: '123456:token',
    });

    const { db: unverifiedDb } = createMockDb({
      selectResults: [
        [{ phoneHash: null, phoneVerifiedAt: null }],
        [{ phoneHash: null, phoneVerifiedAt: null }],
      ],
    });
    getDbMock.mockReturnValue(unverifiedDb as never);
    expect(await enabledService.shouldRequirePhoneForTrial(500)).toBe(true);
    expect(await enabledService.shouldRequirePhoneForPurchase(500)).toBe(true);

    const { db: verifiedDb } = createMockDb({
      selectResults: [
        [{ phoneHash: 'abc123', phoneVerifiedAt: new Date() }],
        [{ phoneHash: 'abc123', phoneVerifiedAt: new Date() }],
      ],
    });
    getDbMock.mockReturnValue(verifiedDb as never);
    expect(await enabledService.shouldRequirePhoneForTrial(500)).toBe(false);
    expect(await enabledService.shouldRequirePhoneForPurchase(500)).toBe(false);
  });
});

describe('Telegram conversations, storefront checkout, and phone gates', () => {
  it('verifyPhoneConversation rejects spoofed contact.user_id !== from.id and accepts owner contact', async () => {
    const verifyAndBindPhone = vi.fn().mockResolvedValue({
      ok: true,
      phoneHash: 'a'.repeat(64),
      alreadyVerified: false,
    });
    const translationService = new TranslationService();
    const services = createMockServices({
      contactVerificationService: { verifyAndBindPhone } as unknown as Record<string, unknown>,
    });
    services.translationService = translationService;

    const replies: Array<{ text: string; extra?: Record<string, unknown> }> = [];
    const reply = vi.fn(async (text: string, extra?: Record<string, unknown>) => {
      replies.push({ text, extra });
      return { message_id: replies.length + 100 };
    });

    const outsideCtx = {
      from: { id: 777, language_code: 'en' },
      userLocale: 'en' as const,
      session: { phoneVerifyReturnAction: 'trial' as const },
      services,
    };

    const inputs = [
      // Spoofed/forwarded contact belonging to user 999 instead of sender 777
      {
        from: { id: 777, language_code: 'en' },
        userLocale: 'en',
        services,
        message: {
          message_id: 201,
          contact: { phone_number: '+989123456789', first_name: 'Other', user_id: 999 },
        },
        reply,
      },
      // Genuine owner contact matching sender 777
      {
        from: { id: 777, language_code: 'en' },
        userLocale: 'en',
        services,
        message: {
          message_id: 202,
          contact: { phone_number: '+989123456789', first_name: 'Owner', user_id: 777 },
        },
        reply,
      },
    ];

    const conversation = {
      external: vi.fn(async (fn: (ctx: typeof outsideCtx) => unknown) => fn(outsideCtx)),
      wait: vi.fn(async () => inputs.shift()),
      halt: vi.fn(),
    } as unknown as MyConversation;

    const ctx = {
      ...outsideCtx,
      reply,
    } as unknown as ConversationContext;

    await verifyPhoneConversation(conversation, ctx);

    // 1. Initial prompt has request_contact keyboard
    const initialMarkup = replies[0]?.extra?.reply_markup as {
      keyboard?: Array<Array<{ request_contact?: boolean }>>;
    };
    expect(initialMarkup?.keyboard?.[0]?.[0]?.request_contact).toBe(true);

    // 2. Spoofed contact rejected with onboarding_phone_not_owner; service NOT called for it
    expect(replies[1]?.text).toContain('your own Telegram account');

    // 3. Owner contact verified exactly once & custom keyboard removed
    expect(verifyAndBindPhone).toHaveBeenCalledTimes(1);
    expect(verifyAndBindPhone).toHaveBeenCalledWith({
      telegramId: 777,
      rawPhoneNumber: '+989123456789',
    });
    expect(replies[2]?.text).toContain('verified successfully');
    expect(replies[2]?.extra?.reply_markup).toEqual({ remove_keyboard: true });
  });

  it('gates trial:claim when require_phone_for_trial is enabled and user is unverified', async () => {
    const claimTrial = vi.fn();
    const enterConversation = vi.fn().mockResolvedValue(undefined);
    const shouldRequirePhoneForTrial = vi.fn().mockResolvedValue(true);

    const services = createMockServices({
      trialService: { claimTrial },
      contactVerificationService: {
        shouldRequirePhoneForTrial,
        shouldRequirePhoneForPurchase: vi.fn().mockResolvedValue(false),
      } as unknown as Record<string, unknown>,
    });

    const harness = createBotHarness({ services, defaultLocale: 'en' });
    harness.bot.use(async (ctx, next) => {
      (ctx as unknown as { conversation: { enter: typeof enterConversation } }).conversation = {
        enter: enterConversation,
      };
      await next();
    });
    registerBaseRoutes(harness.bot, harness.services);

    await harness.sendCallback('trial:claim', { userId: 42, messageId: 10 });

    expect(shouldRequirePhoneForTrial).toHaveBeenCalledWith(42);
    expect(enterConversation).toHaveBeenCalledWith('verifyPhoneConversation');
    expect(claimTrial).not.toHaveBeenCalled();
  });

  it('renders flash-sale banner in shop menu and discount details in checkout screen', async () => {
    const translationService = new TranslationService();
    const expiresAt = new Date(Date.now() + 3 * 3600_000);
    const activeDiscount: CatalogDiscountRow = {
      id: 'disc_flash',
      title: 'Weekend Flash',
      scope: 'all',
      targetId: null,
      discountType: 'percent',
      value: 20,
      maxDiscountAmount: null,
      startsAt: new Date(Date.now() - 3600_000),
      expiresAt,
      active: true,
      createdAt: new Date(),
    };

    const pkg: PackageOption = {
      id: 'pkg_30gb_30d',
      name: '30 GB - 30 Days',
      gbAmount: 30,
      durationDays: 30,
      price: 100_000,
      enabled: true,
    };

    const ctx = {
      from: { id: 55, language_code: 'en' },
      userLocale: 'en' as const,
      session: {},
      services: {
        translationService,
        pricingService: { getPackages: vi.fn(() => [pkg]) },
        packageCategoryService: { listCategories: vi.fn().mockResolvedValue([]) },
        catalogDiscountService: {
          listActiveDiscounts: vi.fn().mockResolvedValue([activeDiscount]),
        },
      },
    } as unknown as MenuContext;

    const shopText = await renderShopMenuText(ctx);
    expect(shopText).toContain('Weekend Flash');

    const resolved = resolveBestCatalogDiscount([activeDiscount], {
      packageId: pkg.id,
      originalPrice: pkg.price,
    });
    const checkoutText = buildPurchaseCheckoutScreen(
      ctx,
      pkg,
      resolved.effectivePrice,
      undefined,
      200_000,
      resolved
    );
    expect(checkoutText).toContain('Weekend Flash');
    expect(checkoutText).toContain('100,000');
    expect(checkoutText).toContain('80,000');
    expect(checkoutText).toContain('Time remaining');

    const customCheckoutText = buildCustomCheckoutScreen(ctx, {
      mode: 'purchase',
      gbAmount: 20,
      durationDays: 30,
      amount: 80_000,
      pricePerGb: 5_000,
      catalogDiscount: resolved,
    });
    expect(customCheckoutText).toContain('Weekend Flash');
    expect(customCheckoutText).toContain('100,000');
    expect(customCheckoutText).toContain('80,000');
    expect(customCheckoutText).toContain('Time remaining');

    // Wallet statement renders topup_void with localized label & 🚫 icon
    const replyVoid = vi.fn().mockResolvedValue({ message_id: 201 });
    await renderWalletStatementScreen(
      {
        from: { id: 55, language_code: 'en' },
        userLocale: 'en',
        reply: replyVoid,
        services: {
          translationService,
          walletService: {
            listTransactionsForUser: vi.fn().mockResolvedValue({
              transactions: [
                {
                  id: 'tx_void_1',
                  amount: -50_000,
                  balanceAfter: 10_000,
                  type: 'topup_void',
                  description: 'Voided receipt',
                  createdAt: new Date('2026-06-15T12:00:00Z'),
                },
              ],
              total: 1,
              totalPages: 1,
              page: 1,
            }),
          },
        },
      } as unknown as MenuContext,
      1
    );
    expect(replyVoid.mock.calls[0]?.[0]).toContain('🚫');
    expect(replyVoid.mock.calls[0]?.[0]).toContain('Top-up Voided');
  });

  it('adminCatalogDiscountsConversation creates (with Persian digits), toggles, broadcasts, and deletes', async () => {
    expect(isAdminCallbackData('cdisc:create')).toBe(true);
    expect(isAdminCallbackData('trial:claim')).toBe(false);
    expect(isAdminCallbackData('trial:toggle')).toBe(true);

    const createdRow: CatalogDiscountRow = {
      id: 'disc_admin1',
      title: 'Yalda Flash',
      scope: 'all',
      targetId: null,
      discountType: 'percent',
      value: 20,
      maxDiscountAmount: 50_000,
      startsAt: new Date('2026-06-15T00:00:00Z'),
      expiresAt: new Date('2026-06-30T23:59:59Z'),
      active: true,
      createdAt: new Date(),
    };
    const listDiscounts = vi.fn().mockResolvedValue([]);
    const createDiscount = vi.fn().mockResolvedValue(createdRow);
    const getDiscountById = vi.fn().mockResolvedValue(createdRow);
    const toggleDiscount = vi.fn().mockResolvedValue({ ...createdRow, active: false });
    const deleteDiscount = vi.fn().mockResolvedValue(true);
    const createJob = vi.fn().mockResolvedValue({ id: 'job_1', recipientCount: 42 });

    const services = createMockServices({
      catalogDiscountService: {
        listDiscounts,
        createDiscount,
        getDiscountById,
        toggleDiscount,
        deleteDiscount,
      } as unknown as Record<string, unknown>,
      broadcastService: { createJob },
      isAdmin: vi.fn(() => true),
      adminIds: [1],
    });
    services.translationService = new TranslationService();

    const reply = vi.fn().mockResolvedValue({ message_id: 50 });
    const answerCallbackQuery = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      from: { id: 1, language_code: 'en' },
      userLocale: 'en' as const,
      session: {},
      services,
      reply,
    } as unknown as ConversationContext;

    const script: Array<{ callback?: string; text?: string }> = [
      { callback: 'cdisc:create' },
      { text: 'Yalda Flash' },
      { callback: 'cdisc:scope:all' },
      { callback: 'cdisc:type:percent' },
      { text: '۲۰' }, // Persian digits for 20%
      { text: '۵۰۰۰۰' }, // Persian digits for 50,000 cap
      { text: 'now' },
      { text: '2026-12-31' },
      { callback: 'cdisc:toggle:disc_admin1' },
      { callback: 'cdisc:bcast:disc_admin1' },
      { callback: 'cdisc:delete:disc_admin1' },
      { callback: 'cdisc:back' },
    ];

    const conversation = {
      external: vi.fn(async (fn: (outside: unknown) => unknown) => fn(ctx)),
      wait: vi.fn(async () => {
        const next = script.shift()!;
        return {
          ...ctx,
          ...(next.callback
            ? { callbackQuery: { data: next.callback }, answerCallbackQuery }
            : { message: { text: next.text } }),
        };
      }),
      halt: vi.fn(),
    } as unknown as MyConversation;

    await adminCatalogDiscountsConversation(conversation, ctx);

    expect(createDiscount).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Yalda Flash',
        scope: 'all',
        discountType: 'percent',
        value: 20,
        maxDiscountAmount: 50_000,
      })
    );
    expect(toggleDiscount).toHaveBeenCalledWith('disc_admin1');
    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        actorTelegramId: 1,
        audience: 'all',
      })
    );
    expect(deleteDiscount).toHaveBeenCalledWith('disc_admin1');
  });
});

describe('WebApp /api/user/packages, /api/user/quote & phone gate', () => {
  let app: FastifyInstance;
  const expiresAt = new Date('2026-12-31T23:59:59.000Z');
  const activeDiscounts: CatalogDiscountRow[] = [
    {
      id: 'disc_web_all',
      title: 'Web Flash 20%',
      scope: 'all',
      targetId: null,
      discountType: 'percent',
      value: 20,
      maxDiscountAmount: null,
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt,
      active: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  ];

  afterEach(async () => {
    if (app) await app.close();
  });

  it('returns catalog discount metadata in /api/user/packages and /api/user/quote', async () => {
    const { mockServices } = createMockUserServices();
    mockServices.catalogDiscountService = {
      listActiveDiscounts: vi.fn().mockResolvedValue(activeDiscounts),
    } as unknown as CatalogDiscountService;

    app = await createWebAppServer(createTestConfig(), mockServices);
    const token = app.jwt.sign({ telegramId: 55555, role: 'user' });

    const pkgRes = await app.inject({
      method: 'GET',
      url: '/api/user/packages',
      cookies: { session: token },
    });
    expect(pkgRes.statusCode).toBe(200);
    const pkg30 = pkgRes.json().packages.find((p: { id: string }) => p.id === 'pkg_30gb_30d');
    expect(pkg30).toMatchObject({
      id: 'pkg_30gb_30d',
      originalPrice: 120_000,
      effectivePrice: 96_000,
      price: 96_000,
      activeDiscountTitle: 'Web Flash 20%',
      discountExpiresAt: expiresAt.toISOString(),
    });

    const quoteRes = await app.inject({
      method: 'GET',
      url: '/api/user/quote?gb=50&days=30',
      cookies: { session: token },
    });
    expect(quoteRes.statusCode).toBe(200);
    expect(quoteRes.json()).toMatchObject({
      gbAmount: 50,
      durationDays: 30,
      originalPrice: 250_000,
      effectivePrice: 200_000,
      totalPrice: 200_000,
      activeDiscountTitle: 'Web Flash 20%',
      discountExpiresAt: expiresAt.toISOString(),
    });
  });

  it('blocks /api/user/checkout and /api/user/checkout/:id/confirm with 403 PHONE_VERIFICATION_REQUIRED when unverified', async () => {
    const { mockServices } = createMockUserServices();
    mockServices.contactVerificationService = {
      shouldRequirePhoneForPurchase: vi.fn().mockResolvedValue(true),
      shouldRequirePhoneForTrial: vi.fn().mockResolvedValue(true),
    } as unknown as ContactVerificationService;

    app = await createWebAppServer(createTestConfig(), mockServices);
    const token = app.jwt.sign({ telegramId: 55555, role: 'user' });

    const checkoutRes = await app.inject({
      method: 'POST',
      url: '/api/user/checkout',
      cookies: { session: token },
      payload: { packageId: 'pkg_10gb_10d' },
    });
    expect(checkoutRes.statusCode).toBe(403);
    expect(checkoutRes.json().code).toBe('PHONE_VERIFICATION_REQUIRED');

    const confirmRes = await app.inject({
      method: 'POST',
      url: '/api/user/checkout/co_test_123/confirm',
      cookies: { session: token },
    });
    expect(confirmRes.statusCode).toBe(403);
    expect(confirmRes.json().code).toBe('PHONE_VERIFICATION_REQUIRED');
  });
});
