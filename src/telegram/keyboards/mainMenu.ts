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
import { backKeyboard, buildEmptyState, buildScreen, buildStatusBadge } from '../ui.js';
import { showUserSubscriptions } from '../features/subscriptions/routes.js';
import { renderAdminHome } from './adminMenu.js';
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

  const notices: string[] = [];
  if (activeCount === 0) notices.push(`📭 ${t(ctx, 'home_no_active_services_hint')}`);
  if (nearExpiryInfo) {
    notices.push(
      `${buildStatusBadge(ctx, 'warning', t(ctx, 'home_near_expiry_warning'))}\n${tm(
        ctx,
        'home_near_expiry_detail',
        {
          username: nearExpiryInfo.username,
          days: localizedNumber(nearExpiryInfo.daysLeft, ctx),
          days_unit: t(ctx, 'days_unit'),
        }
      )}`
    );
  }

  return buildScreen({
    emoji: '🏠',
    title: t(ctx, 'home_title'),
    subtitle: t(ctx, 'home_subtitle'),
    primary: {
      emoji: '👛',
      label: t(ctx, 'home_balance'),
      value: `${localizedNumber(balance, ctx)} ${t(ctx, 'currency_toman')}`,
    },
    sections: [
      {
        emoji: '📱',
        title: t(ctx, 'home_service_overview'),
        fields: [
          {
            emoji: activeCount > 0 ? '🟢' : '⚪️',
            label: t(ctx, 'home_active_services'),
            value: `${localizedNumber(activeCount, ctx)} ${t(ctx, 'service_unit')}`,
          },
        ],
      },
    ],
    footer: notices.join('\n\n'),
  });
}

/**
 * Render wallet dashboard summary with available balance and pending topup receipt status.
 */
export async function renderWalletDashboard(ctx: MenuContext): Promise<string> {
  const telegramId = ctx.from?.id;
  if (!telegramId || !ctx.services) return t(ctx, 'balance');

  const balance = await ctx.services.walletService.getBalance(telegramId);
  const pendingReceipt = await ctx.services.walletService.getPendingReceiptForUser?.(telegramId);

  return buildScreen({
    emoji: '👛',
    title: t(ctx, 'wallet_dashboard_title'),
    subtitle: t(ctx, 'wallet_dashboard_subtitle'),
    primary: {
      emoji: '💰',
      label: t(ctx, 'wallet_available_balance'),
      value: `${localizedNumber(balance, ctx)} ${t(ctx, 'currency_toman')}`,
    },
    sections: pendingReceipt
      ? [
          {
            emoji: '⏳',
            title: t(ctx, 'wallet_pending_section'),
            fields: [
              {
                emoji: '💰',
                label: t(ctx, 'wallet_pending_amount'),
                value: `${localizedNumber(pendingReceipt.amount, ctx)} ${t(ctx, 'currency_toman')}`,
              },
              {
                emoji: '📅',
                label: t(ctx, 'wallet_pending_submitted'),
                value: localizedDate(pendingReceipt.createdAt, ctx),
              },
              {
                emoji: '⏳',
                label: t(ctx, 'wallet_pending_status'),
                value: t(ctx, 'wallet_pending_status_detail'),
              },
            ],
          },
        ]
      : undefined,
    footer: pendingReceipt ? undefined : `ℹ️ ${t(ctx, 'wallet_dashboard_empty_hint')}`,
  });
}

/**
 * Render shop header text including active promo code if set in session.
 */
export async function renderShopMenuText(ctx: MenuContext): Promise<string> {
  const promoCode = ctx.session.pendingPromo?.code;
  return buildScreen({
    emoji: '🛍️',
    title: t(ctx, 'shop_title'),
    subtitle: t(ctx, 'shop_subtitle'),
    ...(promoCode
      ? {
          primary: {
            emoji: '🎟️',
            label: t(ctx, 'shop_promo_section'),
            value: `\`${promoCode}\``,
          },
        }
      : {}),
    footer: `ℹ️ ${t(ctx, 'shop_hint')}`,
  });
}

function buildInsufficientBalanceScreen(
  ctx: MenuContext,
  packagePrice: number,
  balance: number
): string {
  const deficit = packagePrice - balance;
  return buildScreen({
    emoji: '👛',
    title: t(ctx, 'insufficient_balance_title'),
    subtitle: t(ctx, 'insufficient_balance_subtitle'),
    primary: {
      emoji: '📉',
      label: t(ctx, 'insufficient_balance_deficit_label'),
      value: `${localizedNumber(deficit, ctx)} ${t(ctx, 'currency_toman')}`,
    },
    sections: [
      {
        emoji: '💰',
        title: t(ctx, 'insufficient_balance_wallet_section'),
        fields: [
          {
            emoji: '🛍️',
            label: t(ctx, 'insufficient_balance_price_label'),
            value: `${localizedNumber(packagePrice, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          {
            emoji: '👛',
            label: t(ctx, 'insufficient_balance_balance_label'),
            value: `${localizedNumber(balance, ctx)} ${t(ctx, 'currency_toman')}`,
          },
        ],
      },
    ],
    footer: `ℹ️ ${t(ctx, 'insufficient_balance_hint')}`,
  });
}

function buildPurchaseCheckoutScreen(
  ctx: MenuContext,
  pkg: { name: string; gbAmount: number; durationDays: number; price: number; id: string },
  amount: number,
  promoCode?: string
): string {
  return buildScreen({
    emoji: '🛒',
    title: t(ctx, 'purchase_review_title'),
    subtitle: t(ctx, 'purchase_review_subtitle'),
    primary: {
      emoji: '💰',
      label: t(ctx, 'checkout_total_label'),
      value: `${localizedNumber(amount, ctx)} ${t(ctx, 'currency_toman')}`,
    },
    sections: [
      {
        emoji: '📦',
        title: t(ctx, 'checkout_package_section'),
        fields: [
          {
            emoji: '📦',
            label: t(ctx, 'renewal_success_package_label'),
            value: localizedPackageName(ctx, pkg.id, pkg.name),
          },
          {
            emoji: '📊',
            label: t(ctx, 'checkout_traffic_label'),
            value: `${localizedNumber(pkg.gbAmount, ctx)} ${t(ctx, 'traffic_unit_gb')}`,
          },
          {
            emoji: '⏳',
            label: t(ctx, 'checkout_duration_label'),
            value: `${localizedNumber(pkg.durationDays, ctx)} ${t(ctx, 'days_unit')}`,
          },
          {
            emoji: '💳',
            label: t(ctx, 'checkout_unit_price_label'),
            value: `${localizedNumber(Math.round(pkg.price / pkg.gbAmount), ctx)} ${t(ctx, 'currency_toman')}`,
          },
        ],
      },
      ...(promoCode
        ? [
            {
              emoji: '🎟️',
              title: t(ctx, 'checkout_promo_section'),
              fields: [
                {
                  emoji: '🎟️',
                  label: t(ctx, 'shop_promo_section'),
                  value: `\`${promoCode}\``,
                },
              ],
            },
          ]
        : []),
    ],
    footer: `ℹ️ ${t(ctx, 'purchase_confirmation_hint')}`,
  });
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

      const previewText = buildScreen({
        emoji: '🎁',
        title: t(ctx, 'trial_preview_heading'),
        subtitle: t(ctx, 'trial_preview_subtitle'),
        primary: {
          emoji: '📊',
          label: t(ctx, 'trial_traffic_label'),
          value: `${localizedNumber(trialGb, ctx)} ${t(ctx, 'traffic_unit_gb')}`,
        },
        sections: [
          {
            emoji: '⏳',
            title: t(ctx, 'trial_terms_label'),
            fields: [
              {
                emoji: '📅',
                label: t(ctx, 'trial_duration_label'),
                value: `${localizedNumber(trialDays, ctx)} ${t(ctx, 'days_unit')}`,
              },
            ],
          },
        ],
        footer: `ℹ️ ${t(ctx, 'trial_terms')}`,
      });

      await ctx.editMessageText(previewText, {
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

      await ctx.editMessageText(
        buildScreen({
          emoji: '👥',
          title: t(ctx, 'referral_title'),
          subtitle: t(ctx, 'referral_subtitle'),
          primary: {
            emoji: '🔗',
            label: t(ctx, 'referral_link_label'),
            value: `\`${refLink}\``,
          },
          sections: [
            {
              emoji: '🎁',
              title: t(ctx, 'referral_title'),
              fields: [
                {
                  emoji: '💰',
                  label: t(ctx, 'referral_reward_label'),
                  value: `${localizedNumber(bonus, ctx)} ${t(ctx, 'currency_toman')}`,
                },
              ],
            },
          ],
          footer: `ℹ️ ${t(ctx, 'referral_hint')}`,
        }),
        { parse_mode: 'Markdown', reply_markup: backKeyboard(ctx, 'main') }
      );
    }
  )
  .text(
    (ctx) => t(ctx, 'menu_language'),
    async (ctx) => {
      await ctx.editMessageText(
        buildScreen({
          emoji: '🌐',
          title: t(ctx, 'language_selection_title'),
          subtitle: t(ctx, 'language_selection_subtitle'),
        }),
        { parse_mode: 'Markdown', reply_markup: languageKeyboard(ctx, 'main') }
      );
    }
  )
  .row()
  .text(
    (ctx) => t(ctx, 'menu_support'),
    async (ctx) => {
      if (!ctx.services) return;
      await ctx.editMessageText(
        buildScreen({
          emoji: '💬',
          title: t(ctx, 'support_title'),
          subtitle: t(ctx, 'support_subtitle'),
          footer: t(ctx, 'support_message'),
        }),
        { parse_mode: 'Markdown', reply_markup: backKeyboard(ctx, 'main') }
      );
    }
  )
  .row()
  .dynamic((ctx, range) => {
    if (ctx.from?.id && ctx.services?.isAdmin(ctx.from.id)) {
      range.text(
        (c) => t(c, 'admin_menu_management'),
        async (c) => {
          c.menu.nav('admin-menu');
          await c.editMessageText(renderAdminHome(c), { parse_mode: 'Markdown' });
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
              await c.editMessageText(
                buildEmptyState('⚠️', t(c, 'purchase_review_title'), t(c, pendingPromo.messageKey)),
                { parse_mode: 'Markdown', reply_markup: backKeyboard(c, 'main') }
              );
              return;
            }
            const displayedPrice = pendingPromo.quote?.finalAmount ?? pkg.price;
            const balance = await c.services.walletService.getBalance(telegramId);
            if (balance < displayedPrice) {
              const insufficientKeyboard = new InlineKeyboard()
                .text(t(c, 'direct_topup_button'), 'topup:direct')
                .row()
                .text(t(c, 'menu_back'), 'shop:open');

              await c.editMessageText(buildInsufficientBalanceScreen(c, displayedPrice, balance), {
                parse_mode: 'Markdown',
                reply_markup: insufficientKeyboard,
              });
              return;
            }

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
              await c.editMessageText(
                buildEmptyState(
                  '⚠️',
                  t(c, 'purchase_review_title'),
                  t(c, 'purchase_target_unavailable')
                ),
                { parse_mode: 'Markdown', reply_markup: backKeyboard(c, 'main') }
              );
              return;
            }

            const confirmKeyboard = new InlineKeyboard()
              .text(t(c, 'buy_confirm_button'), `buy:confirm:${checkout.id}`)
              .row()
              .text(t(c, 'menu_back'), 'shop:open');

            await c.editMessageText(
              buildPurchaseCheckoutScreen(c, pkg, displayedPrice, pendingPromo.quote?.code),
              {
                parse_mode: 'Markdown',
                reply_markup: confirmKeyboard,
              }
            );
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
