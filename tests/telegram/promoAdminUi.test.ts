import type { Bot } from 'grammy';
import { describe, expect, it, vi } from 'vitest';
import { registerPromoAdminRoutes } from '../../src/telegram/features/admin/promoRoutes.js';
import { promoDetailView, showPromoCenter } from '../../src/telegram/promoAdminUi.js';
import type { MenuContext } from '../../src/telegram/types.js';

const promo = {
  id: '123e4567-e89b-42d3-a456-426614174000',
  code: 'SUMMER_2026',
  type: 'discount_percent',
  value: 20,
  maxUses: 100,
  maxUsesPerUser: 1,
  currentUses: 4,
  minPurchaseAmount: 50_000,
  expiresAt: null,
  active: true,
  createdAt: new Date(),
};

function context(): { ctx: MenuContext; reply: ReturnType<typeof vi.fn> } {
  const reply = vi.fn().mockResolvedValue({ message_id: 1 });
  const ctx = {
    userLocale: 'en',
    session: {},
    reply,
    services: {
      promoService: {
        listCodes: vi.fn().mockResolvedValue({
          items: [promo],
          total: 1,
          page: 1,
          totalPages: 1,
        }),
        getPromoCode: vi.fn().mockResolvedValue(promo),
        getPromoCodeById: vi.fn().mockResolvedValue(promo),
      },
      translationService: {
        get: vi.fn((key: string, _locale: string, params?: Record<string, string | number>) =>
          params ? `${key}:${JSON.stringify(params)}` : key
        ),
      },
    },
  } as unknown as MenuContext;
  return { ctx, reply };
}

describe('inline promo admin UX', () => {
  it('uses stable callback-safe IDs instead of embedding promo codes', async () => {
    const { ctx, reply } = context();

    await showPromoCenter(ctx);

    const keyboard = (reply.mock.calls[0]![1] as { reply_markup: { inline_keyboard: unknown[][] } })
      .reply_markup;
    const buttons = keyboard.inline_keyboard.flat() as Array<{ callback_data?: string }>;
    const select = buttons.find((button) => button.callback_data?.startsWith('promo:open:'));
    expect(select?.callback_data).toBe(`promo:open:${promo.id}`);
    expect(select?.callback_data).not.toContain(promo.code);
  });

  it('builds a detailed action card with inline toggle and delete controls', async () => {
    const { ctx } = context();

    const detail = await promoDetailView(ctx, promo.id);

    expect(detail?.text).toContain('admin_promo_detail');
    expect(detail?.text).not.toContain('discount_percent');
    expect(ctx.services?.translationService.get).toHaveBeenCalledWith(
      'admin_promo_type_percent',
      'en',
      undefined
    );
    const buttons = detail!.keyboard.inline_keyboard.flat() as Array<{ callback_data?: string }>;
    expect(buttons.some((button) => button.callback_data === `promo:set:0:${promo.id}`)).toBe(true);
    expect(buttons.some((button) => button.callback_data?.startsWith('promo:delete:'))).toBe(true);
  });

  it('uses explicit promo state and treats legacy toggles as refresh-only', async () => {
    const routes: Array<{
      trigger: string | RegExp;
      handler: (ctx: MenuContext & { match: RegExpMatchArray }) => Promise<void>;
    }> = [];
    const bot = {
      callbackQuery(
        trigger: string | RegExp,
        handler: (ctx: MenuContext & { match: RegExpMatchArray }) => Promise<void>
      ) {
        routes.push({ trigger, handler });
        return this;
      },
    };
    registerPromoAdminRoutes(bot as unknown as Bot<MenuContext>);
    const findRoute = (data: string) => {
      for (const route of routes) {
        if (!(route.trigger instanceof RegExp)) continue;
        const match = data.match(route.trigger);
        if (match) return { handler: route.handler, match };
      }
      throw new Error(`Missing promo route for ${data}`);
    };

    const { ctx } = context();
    const setPromoActiveById = vi.fn().mockResolvedValue(true);
    const answerCallbackQuery = vi.fn().mockResolvedValue(undefined);
    Object.assign(ctx, { answerCallbackQuery });
    Object.assign(ctx.services!.promoService, { setPromoActiveById });

    const explicit = findRoute(`promo:set:0:${promo.id}`);
    await explicit.handler(Object.assign(ctx, { match: explicit.match }));
    await explicit.handler(Object.assign(ctx, { match: explicit.match }));

    expect(setPromoActiveById).toHaveBeenCalledTimes(2);
    expect(setPromoActiveById).toHaveBeenNthCalledWith(1, promo.id, false);
    expect(setPromoActiveById).toHaveBeenNthCalledWith(2, promo.id, false);

    const legacy = findRoute(`promo:toggle:${promo.id}`);
    await legacy.handler(Object.assign(ctx, { match: legacy.match }));

    expect(setPromoActiveById).toHaveBeenCalledTimes(2);
    expect(answerCallbackQuery).toHaveBeenLastCalledWith({ text: 'button_refreshed' });
  });
});
