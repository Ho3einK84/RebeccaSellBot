import { describe, expect, it, vi } from 'vitest';
import { TranslationService } from '../../src/domain/services/TranslationService.js';
import { registerPromoAdminRoutes } from '../../src/telegram/features/admin/promoRoutes.js';
import { getEffectivePackagePrice } from '../../src/telegram/keyboards/mainMenu.js';
import {
  promoDetailView,
  showPromoCenter,
  showPromoRedemptions,
} from '../../src/telegram/promoAdminUi.js';
import { validateTelegramMarkdown } from '../../src/telegram/rendering.js';
import type { MenuContext } from '../../src/telegram/types.js';
import {
  createBotHarness,
  createMockServices,
  extractCallbackDataList,
} from './helpers/botHarness.js';

const promo = {
  id: '123e4567-e89b-42d3-a456-426614174000',
  code: 'SUMMER_2026',
  type: 'discount_percent',
  value: 20,
  maxUses: 100,
  maxUsesPerUser: 1,
  currentUses: 4,
  minPurchaseAmount: 50_000,
  maxDiscountAmount: 30_000,
  firstPurchaseOnly: false,
  expiresAt: null,
  active: true,
  createdAt: new Date(),
};

function promoContext(useRealTranslations = false) {
  const reply = vi.fn().mockResolvedValue({ message_id: 1 });
  const services = createMockServices({
    adminIds: [1],
    isAdmin: vi.fn((id) => id === 1),
    promoService: {
      listCodes: vi.fn().mockResolvedValue({ items: [promo], total: 1, page: 1, totalPages: 1 }),
      getPromoCode: vi.fn().mockResolvedValue(promo),
      getPromoCodeById: vi.fn().mockResolvedValue(promo),
      listRedemptions: vi.fn().mockResolvedValue({
        items: [
          {
            id: 'cr_1',
            code: 'SUMMER_2026',
            telegramId: 12345,
            username: 'testuser',
            firstName: 'Test',
            status: 'completed',
            redeemedAt: new Date(),
            purchaseIntentId: 'pi_1',
            purchaseAmount: 80_000,
            purchaseType: 'new_config',
          },
        ],
        total: 1,
        page: 1,
        totalPages: 1,
        code: 'SUMMER_2026',
      }),
    },
  });
  if (useRealTranslations) {
    services.translationService = new TranslationService();
  }

  const ctx = {
    userLocale: 'en',
    session: {},
    reply,
    services,
  } as unknown as MenuContext;

  return { ctx, reply };
}

describe('Inline promo admin UX & pricing calculation', () => {
  it('uses callback-safe UUIDs without embedding raw promo codes and validates detail Markdown', async () => {
    const { ctx, reply } = promoContext();
    await showPromoCenter(ctx);
    const centerCbs = extractCallbackDataList(
      (reply.mock.calls[0]![1] as { reply_markup: unknown }).reply_markup
    );
    const openCb = centerCbs.find((c) => c.startsWith('promo:open:'));
    expect(openCb).toBe(`promo:open:${promo.id}`);
    expect(openCb).not.toContain(promo.code);

    const detail = await promoDetailView(ctx, promo.id);
    expect(detail?.text).toContain('admin_promo_detail_title');
    expect(detail?.text).not.toContain('discount_percent');
    const detailCbs = extractCallbackDataList(detail!.keyboard);
    expect(detailCbs).toContain(`promo:set:0:${promo.id}`);
    expect(detailCbs.some((c) => c.startsWith('promo:delete:'))).toBe(true);

    const { ctx: realDetailCtx } = promoContext(true);
    const realDetail = await promoDetailView(realDetailCtx, promo.id);
    expect(validateTelegramMarkdown(realDetail!.text).valid).toBe(true);
  });

  it('enforces admin auth on promo callbacks, applies explicit state toggles, and treats legacy toggles as refresh', async () => {
    const setPromoActiveById = vi.fn().mockResolvedValue(true);
    const services = createMockServices({
      adminIds: [1],
      isAdmin: vi.fn((id) => id === 1),
      promoService: {
        getPromoCodeById: vi.fn().mockResolvedValue(promo),
        setPromoActiveById,
      },
    });
    const harness = createBotHarness({ services });
    registerPromoAdminRoutes(harness.bot);

    // Non-admin caller blocked
    await harness.sendCallback(`promo:set:0:${promo.id}`, { userId: 999 });
    expect(setPromoActiveById).not.toHaveBeenCalled();
    expect(harness.callsFor('answerCallbackQuery')[0]?.payload.text).toBe('access_denied');

    // Authorized admin explicit state calls twice
    harness.clearCalls();
    await harness.sendCallback(`promo:set:0:${promo.id}`, { userId: 1 });
    await harness.sendCallback(`promo:set:0:${promo.id}`, { userId: 1 });
    expect(setPromoActiveById).toHaveBeenCalledTimes(2);
    expect(setPromoActiveById).toHaveBeenNthCalledWith(1, promo.id, false);
    expect(setPromoActiveById).toHaveBeenNthCalledWith(2, promo.id, false);

    // Legacy toggle refreshes without toggling
    harness.clearCalls();
    await harness.sendCallback(`promo:toggle:${promo.id}`, { userId: 1 });
    expect(setPromoActiveById).toHaveBeenCalledTimes(2);
    expect(harness.callsFor('answerCallbackQuery').at(-1)?.payload.text).toBe('button_refreshed');
  });

  it('renders paginated redemptions with valid Telegram Markdown', async () => {
    const { ctx, reply } = promoContext();
    await showPromoRedemptions(ctx, promo.id, 1);
    expect(ctx.services?.promoService.listRedemptions).toHaveBeenCalledWith(promo.id, 1, 5);
    expect(reply.mock.calls[0]?.[0]).toContain('admin_promo_redemptions_title');

    const { ctx: realCtx, reply: realReply } = promoContext(true);
    await showPromoRedemptions(realCtx, promo.id, 1);
    expect(validateTelegramMarkdown(realReply.mock.calls[0]?.[0] as string).valid).toBe(true);
  });

  it('calculates effective package prices respecting min purchase, percent caps, and fixed discounts', () => {
    const pkg = { id: 'pkg_1', price: 100_000, gbAmount: 10 };

    expect(
      getEffectivePackagePrice(pkg, {
        type: 'discount_percent',
        value: 20,
        minPurchaseAmount: 150_000,
      })
    ).toBe(100_000);

    expect(
      getEffectivePackagePrice(pkg, {
        type: 'discount_percent',
        value: 20,
        minPurchaseAmount: 50_000,
        maxDiscountAmount: 15_000,
      })
    ).toBe(85_000);

    expect(
      getEffectivePackagePrice(pkg, {
        type: 'discount_fixed',
        value: 30_000,
      })
    ).toBe(70_000);
  });
});
