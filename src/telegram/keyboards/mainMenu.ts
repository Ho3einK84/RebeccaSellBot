/**
 * Main and sub-menus for the user-facing bot.
 * Context types are imported from ../types — no local re-definitions.
 */
import { InlineKeyboard } from 'grammy';
import { Menu } from '@grammyjs/menu';
import type { MenuContext, MyConversation } from '../types.js';
import { languageKeyboard } from './language.js';
import { clearPendingPromo, getPendingPromoPricing } from '../promoSelection.js';
import {
  localizedDate,
  localizedNumber,
  localizedPackageName,
  observedContextLocale,
  t,
  tm,
} from '../locale.js';
import { backKeyboard, buildHeader } from '../ui.js';
import { showUserSubscriptions } from '../features/subscriptions/routes.js';
import { customVolumeEnabled } from '../../domain/services/FeatureSettings.js';
import { trackFunnelEvent } from '../../domain/services/FunnelTelemetry.js';

// Re-export so conversations can import from one place
export type { MenuContext, MyConversation };

/**
 * Per-subscription actions only. Navigation belongs to the single completion
 * message emitted after all subscription cards have been sent.
 */
export { buildSubscriptionActionKeyboard } from '../features/subscriptions/routes.js';

/**
 * Render personalized state-aware dashboard summary text for the main home screen.
 */
export async function renderHomeDashboard(ctx: MenuContext): Promise<string> {
  const telegramId = ctx.from?.id;
  if (!telegramId || !ctx.services) return t(ctx, 'main_menu');

  const balance = await ctx.services.walletService.getBalance(telegramId);
  let activeCount = 0;
  let nearExpiryInfo: { username: string; daysLeft: number } | undefined;

  try {
    const configs = await ctx.services.configService.listConfigsForOwner(telegramId);
    const activeConfigs = configs.filter((c) => !c.panelStatus || c.panelStatus === 'active');
    activeCount = activeConfigs.length;

    const now = Math.floor(Date.now() / 1000);
    for (const config of activeConfigs) {
      if (config.panelExpire && config.panelExpire > now) {
        const daysLeft = Math.ceil((config.panelExpire - now) / 86400);
        if (daysLeft <= 3) {
          nearExpiryInfo = { username: config.configUsername, daysLeft };
          break;
        }
      }
    }
  } catch {
    // If config fetch fails gracefully default to 0 count
  }

  const titleKey = t(ctx, 'home_title');
  const title = titleKey !== 'home_title' ? titleKey : 'داشبورد کاربری سرویسها';
  const header = buildHeader('🏠', title);

  const balanceLabel =
    t(ctx, 'home_balance') !== 'home_balance' ? t(ctx, 'home_balance') : 'موجودی کیف پول';
  const activeLabel =
    t(ctx, 'home_active_services') !== 'home_active_services'
      ? t(ctx, 'home_active_services')
      : 'تعداد سرویسهای فعال';
  const tomanLabel =
    t(ctx, 'currency_toman') !== 'currency_toman' ? t(ctx, 'currency_toman') : 'تومان';
  const serviceLabel = t(ctx, 'service_unit') !== 'service_unit' ? t(ctx, 'service_unit') : 'سرویس';
  const daysLabel = t(ctx, 'days_unit') !== 'days_unit' ? t(ctx, 'days_unit') : 'روز';

  let summary = `👛 *${balanceLabel}:* ${localizedNumber(balance, ctx)} ${tomanLabel}\n📱 *${activeLabel}:* ${localizedNumber(activeCount, ctx)} ${serviceLabel}`;

  if (nearExpiryInfo) {
    const warningLabel =
      t(ctx, 'home_near_expiry_warning') !== 'home_near_expiry_warning'
        ? t(ctx, 'home_near_expiry_warning')
        : 'سرویس نیازمند توجه';
    summary += `\n\n⚠️ *${warningLabel}:* \`${nearExpiryInfo.username}\` (${localizedNumber(nearExpiryInfo.daysLeft, ctx)} ${daysLabel})`;
  }

  return `${header}\n${summary}`;
}

/**
 * Render wallet dashboard summary with available balance and pending topup receipt status.
 */
export async function renderWalletDashboard(ctx: MenuContext): Promise<string> {
  const telegramId = ctx.from?.id;
  if (!telegramId || !ctx.services) return t(ctx, 'balance');

  const balance = await ctx.services.walletService.getBalance(telegramId);
  const pendingReceipt = await ctx.services.walletService.getPendingReceiptForUser?.(telegramId);

  const titleKey = t(ctx, 'wallet_dashboard_title');
  const title = titleKey !== 'wallet_dashboard_title' ? titleKey : 'کیف پول حساب کاربری';
  const header = buildHeader('👛', title);
  let text = `${header}\n💰 *موجودی قابل استفاده:* ${localizedNumber(balance, ctx)} تومان`;

  if (pendingReceipt) {
    const formattedAmount = localizedNumber(pendingReceipt.amount, ctx);
    const formattedDate = localizedDate(pendingReceipt.createdAt, ctx);
    text += `\n\n${tm(ctx, 'wallet_pending_receipt_detail', {
      amount: formattedAmount,
      date: formattedDate,
    })}`;
  } else {
    text += `\n\nجهت افزایش موجودی یا ثبت کد تخفیف، از گزینههای زیر استفاده کنید.`;
  }

  return text;
}

/**
 * Render shop header text including active promo code if set in session.
 */
export async function renderShopMenuText(ctx: MenuContext): Promise<string> {
  const baseShop = t(ctx, 'shop');
  if (ctx.session.pendingPromo?.code) {
    const promoLine = tm(ctx, 'shop_promo_active', { code: ctx.session.pendingPromo.code });
    return `${baseShop}\n\n${promoLine}`;
  }
  return baseShop;
}

// ── Main Menu ────────────────────────────────────────────────────────────────

export const mainMenu = new Menu<MenuContext>('main-menu')
  .text(
    (ctx) => t(ctx, 'menu_buy_subscription'),
    async (ctx) => {
      trackFunnelEvent('shop_enter');
      ctx.menu.nav('shop-menu');
      await ctx.editMessageText(await renderShopMenuText(ctx), { parse_mode: 'Markdown' });
    }
  )
  .text(
    (ctx) => t(ctx, 'menu_my_subscriptions'),
    async (ctx) => {
      await showUserSubscriptions(ctx);
    }
  )
  .row()
  .text(
    (ctx) => t(ctx, 'menu_wallet'),
    async (ctx) => {
      ctx.menu.nav('wallet-menu');
      await ctx.editMessageText(await renderWalletDashboard(ctx), { parse_mode: 'Markdown' });
    }
  )
  .text(
    (ctx) => t(ctx, 'menu_free_trial'),
    async (ctx) => {
      const trialGb = ctx.services?.translationService.getSettingNum('trial_gb', 1) ?? 1;
      const trialDays = ctx.services?.translationService.getSettingNum('trial_days', 3) ?? 3;

      const previewKeyboard = new InlineKeyboard()
        .text(t(ctx, 'trial_start_button'), 'trial:claim')
        .row()
        .text(t(ctx, 'menu_back'), 'nav:main');

      const previewText = tm(ctx, 'trial_preview_text', {
        gb: localizedNumber(trialGb, ctx),
        days: localizedNumber(trialDays, ctx),
      });

      await ctx.reply(previewText, {
        parse_mode: 'Markdown',
        reply_markup: previewKeyboard,
      });
    }
  )
  .row()
  .text(
    (ctx) => t(ctx, 'menu_referral'),
    async (ctx) => {
      const telegramId = ctx.from?.id;
      if (!telegramId || !ctx.services) return;
      const u = await ctx.services.walletService.getOrCreateUser(
        telegramId,
        undefined,
        undefined,
        undefined,
        undefined,
        observedContextLocale(ctx)
      );
      const botUsername = ctx.me?.username ?? 'RebeccaSellBot';
      const refLink = `https://t.me/${botUsername}?start=${u.referralCode}`;
      const bonus = ctx.services.translationService.getSettingNum('referral_bonus_toman', 10_000);

      await ctx.reply(
        tm(ctx, 'referral_info', { bonus: localizedNumber(bonus, ctx), ref_link: refLink }),
        { parse_mode: 'Markdown', reply_markup: backKeyboard(ctx, 'main') }
      );
    }
  )
  .text(
    (ctx) => t(ctx, 'menu_language'),
    async (ctx) => {
      await ctx.reply(t(ctx, 'language_selection_prompt'), {
        reply_markup: languageKeyboard(ctx, 'main'),
      });
    }
  )
  .row()
  .text(
    (ctx) => t(ctx, 'menu_support'),
    async (ctx) => {
      if (!ctx.services) return;
      await ctx.reply(t(ctx, 'support_message'), { reply_markup: backKeyboard(ctx, 'main') });
    }
  )
  .row()
  .dynamic((ctx, range) => {
    if (ctx.from?.id && ctx.services?.isAdmin(ctx.from.id)) {
      range.text(
        (c) => t(c, 'admin_menu_management'),
        async (c) => {
          c.menu.nav('admin-menu');
          await c.editMessageText(t(c, 'admin_menu_title'));
        }
      );
    }
  });

// ── Shop Menu ────────────────────────────────────────────────────────────────

export const shopMenu = new Menu<MenuContext>('shop-menu')
  .dynamic((ctx, range) => {
    if (!ctx.services) return;

    if (ctx.session.pendingPromo) {
      range
        .text(
          (c) => t(c, 'shop_clear_promo_button'),
          async (c) => {
            clearPendingPromo(c);
            await c.answerCallbackQuery({ text: t(c, 'operation_cancelled') });
            await c.editMessageText(await renderShopMenuText(c), { parse_mode: 'Markdown' });
          }
        )
        .row();
    }

    const packages = ctx.services.pricingService.getPackages();

    for (const pkg of packages) {
      const isPopular =
        pkg.id.includes('popular') || pkg.id.includes('best') || pkg.id.includes('pro');
      const tag = isPopular ? '⭐ ' : '';

      range
        .text(
          (c) => {
            const name = localizedPackageName(c, pkg.id, pkg.name);
            return `${tag}${t(c, 'package_button', { name, price: localizedNumber(pkg.price, c) })}`;
          },
          async (c) => {
            const telegramId = c.from?.id;
            const chatId = c.chat?.id;
            if (!telegramId || !chatId || !c.services) return;

            const pendingPromo = await getPendingPromoPricing(
              c,
              telegramId,
              pkg.price,
              pkg.gbAmount
            );
            if (pendingPromo.messageKey) {
              await c.reply(t(c, pendingPromo.messageKey), {
                reply_markup: backKeyboard(c, 'main'),
              });
              return;
            }
            const displayedPrice = pendingPromo.quote?.finalAmount ?? pkg.price;
            const balance = await c.services.walletService.getBalance(telegramId);
            if (balance < displayedPrice) {
              const deficit = displayedPrice - balance;
              const insufficientText = tm(c, 'insufficient_balance_detail', {
                price: localizedNumber(displayedPrice, c),
                balance: localizedNumber(balance, c),
                deficit: localizedNumber(deficit, c),
              });

              const insufficientKeyboard = new InlineKeyboard()
                .text(t(c, 'direct_topup_button'), 'topup:direct')
                .row()
                .text(t(c, 'menu_back'), 'nav:main');

              await c.reply(insufficientText, {
                parse_mode: 'Markdown',
                reply_markup: insufficientKeyboard,
              });
              return;
            }

            const pricePerGb = Math.round(pkg.price / pkg.gbAmount);
            const summaryText = pendingPromo.quote
              ? tm(c, 'purchase_quote_with_promo', {
                  gb: localizedNumber(pkg.gbAmount, c),
                  days: localizedNumber(pkg.durationDays, c),
                  amount: localizedNumber(displayedPrice, c),
                  price_per_gb: localizedNumber(pricePerGb, c),
                  promo_code: pendingPromo.quote.code,
                })
              : tm(c, 'purchase_quote', {
                  gb: localizedNumber(pkg.gbAmount, c),
                  days: localizedNumber(pkg.durationDays, c),
                  amount: localizedNumber(displayedPrice, c),
                  price_per_gb: localizedNumber(pricePerGb, c),
                });

            let checkout;
            try {
              checkout = await c.services.purchaseCheckoutService.create({
                telegramId,
                kind: 'new_config',
                pkg,
                promoCode: pendingPromo.promoCode,
                quotedAmount: displayedPrice,
              });
              trackFunnelEvent('checkout_start');
            } catch {
              await c.reply(t(c, 'purchase_target_unavailable'), {
                reply_markup: backKeyboard(c, 'main'),
              });
              return;
            }

            const confirmKeyboard = new InlineKeyboard()
              .text(t(c, 'buy_confirm_button'), `buy:confirm:${checkout.id}`)
              .row()
              .text(t(c, 'menu_cancel'), 'conversation:cancel');

            await c.reply(summaryText, {
              parse_mode: 'Markdown',
              reply_markup: confirmKeyboard,
            });
          }
        )
        .row();
    }

    if (customVolumeEnabled(ctx.services.translationService)) {
      const customPricePerGb = ctx.services.translationService.getSettingNum('price_per_gb', 5000);
      range
        .text(
          (c) => t(c, 'menu_custom_amount', { price: localizedNumber(customPricePerGb, c) }),
          async (c) => {
            if (!c.services || !customVolumeEnabled(c.services.translationService)) {
              await c.reply(t(c, 'custom_volume_unavailable'), {
                reply_markup: backKeyboard(c, 'main'),
              });
              return;
            }
            await c.conversation.enter('customAmountConversation');
          }
        )
        .row();
    }
  })
  .row()
  .text(
    (ctx) => t(ctx, 'menu_back'),
    async (ctx) => {
      ctx.menu.nav('main-menu');
      await ctx.editMessageText(await renderHomeDashboard(ctx), { parse_mode: 'Markdown' });
    }
  );

// ── Wallet Menu ──────────────────────────────────────────────────────────────

export const walletMenu = new Menu<MenuContext>('wallet-menu')
  .text(
    (ctx) => t(ctx, 'menu_top_up'),
    async (ctx) => {
      await ctx.conversation.enter('topupConversation');
    }
  )
  .text(
    (ctx) => t(ctx, 'menu_use_promo'),
    async (ctx) => {
      await ctx.conversation.enter('promoConversation');
    }
  )
  .row()
  .text(
    (ctx) => t(ctx, 'menu_back_main'),
    async (ctx) => {
      ctx.menu.nav('main-menu');
      await ctx.editMessageText(await renderHomeDashboard(ctx), { parse_mode: 'Markdown' });
    }
  );

// Register submenus
mainMenu.register(shopMenu);
mainMenu.register(walletMenu);
