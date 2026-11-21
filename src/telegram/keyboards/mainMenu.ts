/**
 * Main and sub-menus for the user-facing bot.
 * Context types are imported from ../types — no local re-definitions.
 */
import { InlineKeyboard } from 'grammy';
import { Menu } from '@grammyjs/menu';
import type { MenuContext, MyConversation } from '../types.js';
import { languageKeyboard } from './language.js';
import { renderHomeDashboard } from './homeDashboard.js';
import { getPendingPromoPricing } from '../promoSelection.js';
import {
  formatPackageButtonLabel,
  localizedDate,
  localizedNumber,
  localizedPackageName,
  observedContextLocale,
  resolveContextLocale,
  t,
} from '../locale.js';
import {
  formatRemainingDiscountDuration,
  type PackageOption,
} from '../../domain/services/PricingService.js';
import {
  resolveBestCatalogDiscount,
  safeListActiveDiscounts,
  type CatalogDiscountRow,
  type ResolvedCatalogDiscount,
} from '../../domain/services/CatalogDiscountService.js';
import { ContactVerificationService } from '../../domain/services/ContactVerificationService.js';
import { backKeyboard, buildUserEmptyState, buildUserScreen, renderScreen } from '../ui.js';
import { showUserSubscriptions } from '../features/subscriptions/routes.js';
import { renderLuckyWheelScreen } from '../features/luckyWheelRoutes.js';
import { renderAdminHome } from './adminMenu.js';
import {
  customServiceNameEnabled,
  customVolumeEnabled,
  walletTransferEnabled,
} from '../../domain/services/FeatureSettings.js';
import { trackFunnelEvent } from '../../domain/services/FunnelTelemetry.js';
import { escapeTelegramMarkdown, sanitizeTelegramInlineCode } from '../rendering.js';

// Re-export so conversations can import from one place
export type { MenuContext, MyConversation };

/**
 * Per-subscription actions only. Navigation belongs to the single completion
 * message emitted after all subscription cards have been sent.
 */
export { buildSubscriptionActionKeyboard } from '../features/subscriptions/routes.js';

export { renderHomeDashboard };

/**
 * Render wallet dashboard summary with available balance and pending topup receipt status.
 */
export async function renderWalletDashboard(ctx: MenuContext): Promise<string> {
  const telegramId = ctx.from?.id;
  if (!telegramId || !ctx.services) return t(ctx, 'balance');

  const [balance, pendingReceipt] = await Promise.all([
    ctx.services.walletService.getBalance(telegramId),
    ctx.services.walletService.getPendingReceiptForUser?.(telegramId) ?? Promise.resolve(null),
  ]);

  return buildUserScreen({
    emoji: '💳',
    title: t(ctx, 'wallet_dashboard_title'),
    subtitle: t(ctx, 'wallet_dashboard_subtitle'),
    primary: {
      label: t(ctx, 'wallet_available_balance'),
      value: `${localizedNumber(balance, ctx)} ${t(ctx, 'currency_toman')}`,
      emphasizeValue: true,
    },
    sections: [
      {
        title: t(ctx, 'wallet_user_info_section'),
        fields: [
          {
            label: t(ctx, 'wallet_user_id_label'),
            value: `\`${telegramId}\``,
          },
        ],
      },
      ...(pendingReceipt
        ? [
            {
              emoji: '⏳',
              title: t(ctx, 'wallet_pending_section'),
              fields: [
                {
                  label: t(ctx, 'wallet_pending_amount'),
                  value: `${localizedNumber(pendingReceipt.amount, ctx)} ${t(ctx, 'currency_toman')}`,
                },
                {
                  label: t(ctx, 'wallet_pending_submitted'),
                  value: localizedDate(pendingReceipt.createdAt, ctx),
                },
                {
                  label: t(ctx, 'wallet_pending_status'),
                  value: t(ctx, 'wallet_pending_status_detail'),
                },
              ],
            },
          ]
        : []),
    ],
    footer: pendingReceipt ? undefined : t(ctx, 'wallet_dashboard_empty_hint'),
  });
}

function formatShopPromoBadge(
  ctx: MenuContext,
  pendingPromo: NonNullable<MenuContext['session']['pendingPromo']>
): string {
  const safeCode = `\`${sanitizeTelegramInlineCode(pendingPromo.code)}\``;
  if (pendingPromo.type === 'discount_percent' && pendingPromo.value > 0) {
    return `${safeCode} ${t(ctx, 'shop_promo_discount_suffix', {
      percent: localizedNumber(pendingPromo.value, ctx),
    })}`;
  }
  if (pendingPromo.type === 'discount_fixed' && pendingPromo.value > 0) {
    return `${safeCode} ${t(ctx, 'shop_promo_fixed_suffix', {
      amount: localizedNumber(pendingPromo.value, ctx),
    })}`;
  }
  return safeCode;
}

function findFeaturedShopDiscount(
  packages: readonly PackageOption[],
  activeDiscounts: readonly CatalogDiscountRow[]
): ResolvedCatalogDiscount | undefined {
  if (activeDiscounts.length === 0) return undefined;
  let featured: ResolvedCatalogDiscount | undefined;
  for (const pkg of packages) {
    const resolved = resolveBestCatalogDiscount(activeDiscounts, {
      packageId: pkg.id,
      categoryId: pkg.categoryId ?? null,
      originalPrice: pkg.price,
    });
    if (resolved.discountAmount <= 0) continue;
    if (!featured || resolved.discountAmount > featured.discountAmount) {
      featured = resolved;
    }
  }
  if (!featured) {
    const fallbackAll = activeDiscounts.find((d) => d.scope === 'all');
    if (fallbackAll) {
      featured = {
        originalPrice: 0,
        effectivePrice: 0,
        discountAmount: fallbackAll.value,
        activeDiscountId: fallbackAll.id,
        activeDiscountTitle: fallbackAll.title,
        discountExpiresAt: fallbackAll.expiresAt ? new Date(fallbackAll.expiresAt) : null,
      };
    }
  }
  return featured;
}

function buildShopDiscountBannerField(
  ctx: MenuContext,
  featured: ResolvedCatalogDiscount | undefined
): Array<{ emoji?: string; label?: string; value: string }> {
  if (!featured?.activeDiscountTitle) return [];
  const locale = resolveContextLocale(ctx);
  const remaining = formatRemainingDiscountDuration(featured.discountExpiresAt, locale);
  return [
    {
      value: t(ctx, 'shop_discount_banner', {
        name: escapeTelegramMarkdown(featured.activeDiscountTitle),
        remaining,
      }),
    },
  ];
}

/**
 * Render shop header text with live catalog summary, active category, and promo code if set.
 */
export async function renderShopMenuText(ctx: MenuContext): Promise<string> {
  const pendingPromo = ctx.session.pendingPromo;
  const packages = ctx.services?.pricingService?.getPackages?.() ?? [];
  const categories = (await ctx.services?.packageCategoryService?.listCategories?.(false)) ?? [];
  const activeDiscounts = ctx.services
    ? await safeListActiveDiscounts(ctx.services.catalogDiscountService)
    : [];
  const isCustomEnabled = ctx.services?.translationService
    ? customVolumeEnabled(ctx.services.translationService)
    : false;
  const customPricePerGb = ctx.services?.translationService?.getSettingNum('price_per_gb', 5000);

  if (ctx.session.activeShopCategory && ctx.services) {
    const category = await ctx.services.packageCategoryService?.getCategoryById(
      ctx.session.activeShopCategory
    );
    if (category) {
      const catPackages =
        ctx.services.pricingService?.getPackages?.(
          undefined,
          undefined,
          false,
          ctx.session.activeShopCategory
        ) ?? [];
      const featuredCategoryDiscount = findFeaturedShopDiscount(catPackages, activeDiscounts);
      return buildUserScreen({
        emoji: category.icon || '📦',
        title: escapeTelegramMarkdown(category.name),
        subtitle: escapeTelegramMarkdown(category.description || t(ctx, 'shop_category_subtitle')),
        ...(pendingPromo
          ? {
              primary: {
                emoji: '🎟️',
                label: t(ctx, 'shop_promo_section'),
                value: formatShopPromoBadge(ctx, pendingPromo),
              },
            }
          : {}),
        sections: [
          {
            bullet: '',
            fields: [
              ...buildShopDiscountBannerField(ctx, featuredCategoryDiscount),
              {
                label: t(ctx, 'shop_available_plans_label'),
                value:
                  catPackages.length > 0
                    ? t(ctx, 'shop_available_plans_plain', {
                        packages: localizedNumber(catPackages.length, ctx),
                      })
                    : t(ctx, 'shop_category_empty'),
              },
            ],
          },
        ],
        footer: t(ctx, 'shop_hint'),
      });
    }
  }

  if (packages.length === 0 && !isCustomEnabled) {
    return buildUserEmptyState('🛍️', t(ctx, 'shop_title'), t(ctx, 'shop_empty_message'));
  }

  const featuredDiscount = findFeaturedShopDiscount(packages, activeDiscounts);
  const nonEmptyCategoryCount = categories.filter((cat) =>
    packages.some((pkg) => pkg.categoryId === cat.id)
  ).length;

  const catalogFields = [
    ...buildShopDiscountBannerField(ctx, featuredDiscount),
    ...(packages.length > 0
      ? [
          {
            label: t(ctx, 'shop_available_plans_label'),
            value:
              nonEmptyCategoryCount > 0
                ? t(ctx, 'shop_available_plans_value', {
                    packages: localizedNumber(packages.length, ctx),
                    categories: localizedNumber(nonEmptyCategoryCount, ctx),
                  })
                : t(ctx, 'shop_available_plans_plain', {
                    packages: localizedNumber(packages.length, ctx),
                  }),
          },
        ]
      : []),
    ...(isCustomEnabled && customPricePerGb !== undefined
      ? [
          {
            label: t(ctx, 'shop_custom_volume_label'),
            value: t(ctx, 'shop_custom_volume_value', {
              price: localizedNumber(customPricePerGb, ctx),
            }),
          },
        ]
      : []),
  ];

  return buildUserScreen({
    emoji: '🛍️',
    title: t(ctx, 'shop_title'),
    subtitle: t(ctx, 'shop_subtitle'),
    ...(pendingPromo
      ? {
          primary: {
            emoji: '🎟️',
            label: t(ctx, 'shop_promo_section'),
            value: formatShopPromoBadge(ctx, pendingPromo),
          },
        }
      : {}),
    sections: [
      {
        title: t(ctx, 'shop_catalog_section'),
        fields: catalogFields,
      },
    ],
    footer: t(ctx, 'shop_hint'),
  });
}

function buildInsufficientBalanceScreen(
  ctx: MenuContext,
  packagePrice: number,
  balance: number
): string {
  const deficit = packagePrice - balance;
  return buildUserScreen({
    emoji: '💳',
    title: t(ctx, 'insufficient_balance_title'),
    subtitle: t(ctx, 'insufficient_balance_subtitle'),
    primary: {
      emoji: '🔻',
      label: t(ctx, 'insufficient_balance_deficit_label'),
      value: `${localizedNumber(deficit, ctx)} ${t(ctx, 'currency_toman')}`,
      emphasizeValue: true,
    },
    sections: [
      {
        title: t(ctx, 'insufficient_balance_wallet_section'),
        fields: [
          {
            label: t(ctx, 'insufficient_balance_price_label'),
            value: `${localizedNumber(packagePrice, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          {
            label: t(ctx, 'insufficient_balance_balance_label'),
            value: `${localizedNumber(balance, ctx)} ${t(ctx, 'currency_toman')}`,
          },
        ],
      },
    ],
    footer: t(ctx, 'insufficient_balance_hint'),
  });
}

export function buildPurchaseCheckoutScreen(
  ctx: MenuContext,
  pkg: { name: string; gbAmount: number; durationDays: number; price: number; id: string },
  amount: number,
  promoCode?: string,
  walletBalance?: number,
  catalogDiscount?: ResolvedCatalogDiscount
): string {
  const hasCatalogDiscount = Boolean(catalogDiscount && catalogDiscount.discountAmount > 0);
  const currency = t(ctx, 'currency_toman');
  const locale = resolveContextLocale(ctx);

  return buildUserScreen({
    emoji: '🧾',
    title: t(ctx, 'purchase_review_title'),
    subtitle: t(ctx, 'purchase_review_subtitle'),
    primary: {
      label: t(ctx, 'checkout_total_label'),
      value: `${localizedNumber(amount, ctx)} ${currency}`,
      emphasizeValue: true,
    },
    sections: [
      {
        title: t(ctx, 'checkout_package_section'),
        fields: [
          {
            label: t(ctx, 'checkout_package_label'),
            value: escapeTelegramMarkdown(localizedPackageName(ctx, pkg.id, pkg.name)),
          },
          {
            label: t(ctx, 'checkout_traffic_label'),
            value: `${localizedNumber(pkg.gbAmount, ctx)} ${t(ctx, 'traffic_unit_gb')}`,
          },
          {
            label: t(ctx, 'checkout_duration_label'),
            value: `${localizedNumber(pkg.durationDays, ctx)} ${t(ctx, 'days_unit')}`,
          },
          {
            label: t(ctx, 'checkout_unit_price_label'),
            value: `${localizedNumber(pkg.gbAmount > 0 ? Math.round(amount / pkg.gbAmount) : amount, ctx)} ${currency}`,
          },
        ],
      },
      ...(hasCatalogDiscount && catalogDiscount
        ? [
            {
              emoji: '🔥',
              title: t(ctx, 'checkout_catalog_discount_label', {
                name: escapeTelegramMarkdown(catalogDiscount.activeDiscountTitle ?? ''),
              }),
              fields: [
                {
                  label: t(ctx, 'checkout_original_price_label'),
                  value: `${localizedNumber(catalogDiscount.originalPrice, ctx)} ${currency}`,
                },
                {
                  label: t(ctx, 'checkout_effective_price_label'),
                  value: t(ctx, 'shop_discount_price_line', {
                    price: localizedNumber(catalogDiscount.originalPrice, ctx),
                    amount: localizedNumber(catalogDiscount.effectivePrice, ctx),
                    currency,
                  }),
                },
                ...(catalogDiscount.discountExpiresAt
                  ? [
                      {
                        emoji: '⏳',
                        value: t(ctx, 'shop_discount_time_remaining', {
                          remaining: formatRemainingDiscountDuration(
                            catalogDiscount.discountExpiresAt,
                            locale
                          ),
                        }),
                      },
                    ]
                  : []),
              ],
            },
          ]
        : []),
      ...(walletBalance !== undefined
        ? [
            {
              title: t(ctx, 'checkout_wallet_section'),
              fields: [
                {
                  label: t(ctx, 'checkout_wallet_balance_label'),
                  value: `${localizedNumber(walletBalance, ctx)} ${currency}`,
                },
                {
                  label: t(ctx, 'checkout_remaining_balance_label'),
                  value: `${localizedNumber(Math.max(0, walletBalance - amount), ctx)} ${currency}`,
                },
              ],
            },
          ]
        : []),
      ...(promoCode
        ? [
            {
              emoji: '🎟️',
              title: t(ctx, 'checkout_promo_section'),
              fields: [
                {
                  label: t(ctx, 'shop_promo_section'),
                  value: `\`${sanitizeTelegramInlineCode(promoCode)}\``,
                },
                ...((catalogDiscount?.effectivePrice ?? pkg.price) > amount
                  ? [
                      {
                        label: t(ctx, 'checkout_discount_label'),
                        value: `${localizedNumber((catalogDiscount?.effectivePrice ?? pkg.price) - amount, ctx)} ${currency}`,
                      },
                    ]
                  : []),
              ],
            },
          ]
        : []),
    ],
    footer: t(ctx, 'purchase_confirmation_hint'),
  });
}

export function resolveSupportInfo(ctx: MenuContext): {
  url?: string;
  rawValue: string;
  isConfigured: boolean;
} {
  const dest = ctx.services?.translationService.getSetting('support_destination')?.trim() || '';
  if (dest) {
    if (dest.startsWith('@') || /^[a-zA-Z0-9_]{5,32}$/.test(dest)) {
      const username = dest.replace(/^@/, '');
      return { url: `https://t.me/${username}`, rawValue: `@${username}`, isConfigured: true };
    }
    if (/^[1-9]\d{4,16}$/.test(dest)) {
      return { url: `tg://user?id=${dest}`, rawValue: dest, isConfigured: true };
    }
  }
  if (ctx.services?.supportUrl) {
    return { url: ctx.services.supportUrl, rawValue: ctx.services.supportUrl, isConfigured: true };
  }
  const fallbackAdminId = ctx.services?.adminService?.adminIds[0];
  if (fallbackAdminId) {
    const fallbackUrl = `tg://user?id=${fallbackAdminId}`;
    return { url: fallbackUrl, rawValue: String(fallbackAdminId), isConfigured: true };
  }
  return { isConfigured: false, rawValue: '' };
}

// ── Main Menu ────────────────────────────────────────────────────────────────

export const mainMenu = new Menu<MenuContext>('main-menu')
  .dynamic((ctx, range) => {
    if (ctx.services?.webAppUrl) {
      range.webApp((c) => t(c, 'menu_webapp_launch'), ctx.services.webAppUrl).row();
    }
  })
  .text(
    (ctx) => t(ctx, 'menu_buy_subscription'),
    async (ctx) => {
      trackFunnelEvent('shop_enter');
      ctx.menu.nav('shop-menu');
      await renderScreen(ctx, await renderShopMenuText(ctx), { parse_mode: 'Markdown' });
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
      await renderScreen(ctx, await renderWalletDashboard(ctx), { parse_mode: 'Markdown' });
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
        .text(t(ctx, 'menu_back_main'), 'nav:main');

      const previewText = buildUserScreen({
        emoji: '🎁',
        title: t(ctx, 'trial_preview_heading'),
        subtitle: t(ctx, 'trial_preview_subtitle'),
        sections: [
          {
            bullet: '',
            fields: [
              {
                label: t(ctx, 'trial_traffic_label'),
                value: `${localizedNumber(trialGb, ctx)} ${t(ctx, 'traffic_unit_gb')}`,
              },
              {
                label: t(ctx, 'trial_duration_label'),
                value: `${localizedNumber(trialDays, ctx)} ${t(ctx, 'days_unit')}`,
              },
            ],
          },
        ],
        footer: t(ctx, 'trial_terms'),
      });

      await renderScreen(ctx, previewText, {
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
      const [u, stats] = await Promise.all([
        ctx.services.walletService.getOrCreateUser(
          telegramId,
          ctx.from?.username ?? null,
          ctx.from?.first_name ?? null,
          ctx.from?.last_name ?? null,
          undefined,
          observedContextLocale(ctx)
        ),
        ctx.services.referralService.getReferralStats(telegramId),
      ]);
      const botUsername = ctx.services?.botUsername ?? ctx.me?.username ?? 'RebeccaSellBot';
      const refLink = `https://t.me/${botUsername}?start=${u.referralCode}`;
      const bonus = ctx.services.translationService.getSettingNum('referral_bonus_toman', 10_000);
      const cashbackPercent = ctx.services.translationService.getSettingNum('cashback_percent', 0);
      const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(refLink)}`;
      const refKeyboard = new InlineKeyboard()
        .url(t(ctx, 'referral_share_button'), shareUrl)
        .row()
        .text(t(ctx, 'menu_back_main'), 'nav:main');

      await renderScreen(
        ctx,
        buildUserScreen({
          emoji: '🎁',
          title: t(ctx, 'referral_title'),
          subtitle: t(ctx, 'referral_subtitle'),
          primary: {
            emoji: '🔗',
            label: t(ctx, 'referral_link_label'),
            value: `\`${sanitizeTelegramInlineCode(refLink)}\``,
          },
          sections: [
            {
              title: t(ctx, 'referral_terms_section'),
              fields: [
                {
                  label: t(ctx, 'referral_reward_label'),
                  value: `${localizedNumber(bonus, ctx)} ${t(ctx, 'currency_toman')}`,
                },
                ...(cashbackPercent > 0
                  ? [
                      {
                        label: t(ctx, 'referral_cashback_label'),
                        value: `${localizedNumber(cashbackPercent, ctx)}%`,
                      },
                    ]
                  : []),
              ],
            },
            {
              title: t(ctx, 'referral_stats_section'),
              fields: [
                {
                  label: t(ctx, 'referral_total_invited_label'),
                  value: `${localizedNumber(stats.totalInvited, ctx)} ${t(ctx, 'user_unit')}`,
                },
                {
                  label: t(ctx, 'referral_active_buyers_label'),
                  value: `${localizedNumber(stats.activeBuyers, ctx)} ${t(ctx, 'user_unit')}`,
                },
                {
                  label: t(ctx, 'referral_total_earned_label'),
                  value: `${localizedNumber(stats.totalReferralBonus, ctx)} ${t(ctx, 'currency_toman')}`,
                },
              ],
            },
          ],
          footer: t(ctx, 'referral_hint'),
        }),
        { parse_mode: 'Markdown', reply_markup: refKeyboard }
      );
    }
  )
  .dynamic((ctx, range) => {
    const wheelEnabled =
      ctx.services?.translationService.getSettingBool('lucky_wheel_enabled', true) ?? true;
    if (wheelEnabled || (ctx.from?.id && ctx.services?.isAdmin(ctx.from.id))) {
      range.text(
        (c) => t(c, 'menu_lucky_wheel'),
        async (c) => {
          await renderLuckyWheelScreen(c);
        }
      );
    }
  })
  .row()
  .dynamic((ctx, range) => {
    const languageSelectionEnabled =
      ctx.services?.translationService.getSettingBool('language_selection_enabled', true) ?? true;
    const supportEnabled =
      ctx.services?.translationService.getSettingBool('support_enabled', true) ?? true;
    if (languageSelectionEnabled || (ctx.from?.id && ctx.services?.isAdmin(ctx.from.id))) {
      range.text(
        (c) => t(c, 'menu_language'),
        async (c) => {
          await renderScreen(
            c,
            buildUserScreen({
              emoji: '🌐',
              title: t(c, 'language_selection_title'),
              subtitle: t(c, 'language_selection_subtitle'),
            }),
            { parse_mode: 'Markdown', reply_markup: languageKeyboard(c, 'main') }
          );
        }
      );
    }
    if (supportEnabled) {
      range.text(
        (c) => t(c, 'menu_support'),
        async (c) => {
          if (!c.services) return;
          const supportInfo = resolveSupportInfo(c);
          const keyboard = new InlineKeyboard();
          if (supportInfo.isConfigured && supportInfo.url) {
            keyboard.url(t(c, 'support_contact_button'), supportInfo.url).row();
          }
          keyboard.text(t(c, 'menu_back_main'), 'nav:main');
          await renderScreen(
            c,
            buildUserScreen({
              emoji: '💬',
              title: t(c, 'support_title'),
              subtitle: t(c, 'support_subtitle'),
              footer: supportInfo.isConfigured
                ? t(c, 'support_message')
                : `⚠️ ${t(c, 'support_not_configured')}`,
            }),
            { parse_mode: 'Markdown', reply_markup: keyboard }
          );
        }
      );
    }
  })
  .row()
  .dynamic((ctx, range) => {
    if (ctx.from?.id && ctx.services?.isAdmin(ctx.from.id)) {
      range.text(
        (c) => t(c, 'admin_menu_management'),
        async (c) => {
          if (!c.from?.id || !c.services?.isAdmin(c.from.id)) {
            await c.answerCallbackQuery({ text: t(c, 'access_denied'), show_alert: true });
            return;
          }
          c.menu.nav('admin-menu');
          await renderScreen(c, await renderAdminHome(c), { parse_mode: 'Markdown' });
        }
      );
    }
  });

export function getEffectivePackagePrice(
  pkg: { price: number; gbAmount: number },
  pendingPromo?: {
    type: string;
    value: number;
    minPurchaseAmount?: number;
    maxDiscountAmount?: number | null;
  }
): number {
  if (!pendingPromo) return pkg.price;
  if (pendingPromo.minPurchaseAmount && pkg.price < pendingPromo.minPurchaseAmount) {
    return pkg.price;
  }
  if (pendingPromo.type === 'discount_percent') {
    let discount = Math.floor((pkg.price * pendingPromo.value) / 100);
    if (
      pendingPromo.maxDiscountAmount !== undefined &&
      pendingPromo.maxDiscountAmount !== null &&
      pendingPromo.maxDiscountAmount > 0
    ) {
      discount = Math.min(discount, pendingPromo.maxDiscountAmount);
    }
    return Math.max(0, pkg.price - discount);
  }
  if (pendingPromo.type === 'discount_fixed') {
    return Math.max(0, pkg.price - pendingPromo.value);
  }
  return pkg.price;
}

// ── Shop Menu ────────────────────────────────────────────────────────────────

async function enforcePurchasePhoneGate(
  ctx: MenuContext,
  returnAction: 'shop' | 'custom_amount'
): Promise<boolean> {
  const telegramId = ctx.from?.id;
  if (!telegramId || !ctx.services) return false;
  const phoneService =
    ctx.services.contactVerificationService ??
    new ContactVerificationService({
      translationService: ctx.services.translationService,
    });
  if (!(await phoneService.shouldRequirePhoneForPurchase(telegramId))) {
    return false;
  }

  ctx.session.phoneVerifyReturnAction = returnAction;
  if (typeof ctx.conversation?.enter === 'function') {
    await ctx.conversation.enter('verifyPhoneConversation');
  } else {
    await renderScreen(
      ctx,
      buildUserEmptyState(
        '📱',
        t(ctx, 'onboarding_phone_verify_title'),
        t(ctx, 'purchase_phone_required')
      ),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(t(ctx, 'button_share_phone'), 'phone:verify:start')
          .row()
          .text(t(ctx, 'menu_back_shop'), 'nav:shop'),
      }
    );
  }
  return true;
}

function renderPackageButtons(
  range: Parameters<Parameters<typeof shopMenu.dynamic>[0]>[1],
  packages: readonly PackageOption[],
  activeDiscounts: readonly CatalogDiscountRow[] = []
) {
  for (const pkg of packages) {
    const isPopular =
      pkg.id.includes('popular') || pkg.id.includes('best') || pkg.id.includes('pro');
    const tag = isPopular ? '⭐ ' : '';
    const catalogDiscount = resolveBestCatalogDiscount(activeDiscounts, {
      packageId: pkg.id,
      categoryId: pkg.categoryId ?? null,
      originalPrice: pkg.price,
    });

    range
      .text(
        (c) => {
          const basePrice = catalogDiscount.effectivePrice;
          const effectivePrice = getEffectivePackagePrice(
            { price: basePrice, gbAmount: pkg.gbAmount },
            c.session.pendingPromo
          );
          if (catalogDiscount.discountAmount > 0) {
            const locale = resolveContextLocale(c);
            const label = formatPackageButtonLabel(c, pkg, {
              effectivePrice,
              tag: `${tag}🔥 `,
            });
            const origPrice = localizedNumber(catalogDiscount.originalPrice, c);
            const remaining = catalogDiscount.discountExpiresAt
              ? ` · ⏳ ${formatRemainingDiscountDuration(catalogDiscount.discountExpiresAt, locale)}`
              : '';
            return `${label} (${origPrice})${remaining}`;
          }
          return formatPackageButtonLabel(c, pkg, { effectivePrice, tag });
        },
        async (c) => {
          const telegramId = c.from?.id;
          const chatId = c.chat?.id;
          if (!telegramId || !chatId || !c.services) return;

          if (await enforcePurchasePhoneGate(c, 'shop')) {
            return;
          }

          const latestDiscounts = await safeListActiveDiscounts(c.services.catalogDiscountService);
          const liveDiscount = resolveBestCatalogDiscount(latestDiscounts, {
            packageId: pkg.id,
            categoryId: pkg.categoryId ?? null,
            originalPrice: pkg.price,
          });
          const effectivePkg: PackageOption =
            liveDiscount.discountAmount > 0 ? { ...pkg, price: liveDiscount.effectivePrice } : pkg;

          const pendingPromo = await getPendingPromoPricing(
            c,
            telegramId,
            effectivePkg.price,
            pkg.gbAmount
          );
          if (pendingPromo.messageKey) {
            await renderScreen(
              c,
              buildUserEmptyState(
                '⚠️',
                t(c, 'purchase_review_title'),
                t(c, pendingPromo.messageKey)
              ),
              { parse_mode: 'Markdown', reply_markup: backKeyboard(c, 'main') }
            );
            return;
          }
          const displayedPrice = pendingPromo.quote?.finalAmount ?? effectivePkg.price;
          const balance = await c.services.walletService.getBalance(telegramId);
          if (balance < displayedPrice) {
            const insufficientKeyboard = new InlineKeyboard()
              .text(t(c, 'direct_topup_button'), 'topup:direct')
              .row()
              .text(t(c, 'menu_back_shop'), 'nav:shop');

            await renderScreen(c, buildInsufficientBalanceScreen(c, displayedPrice, balance), {
              parse_mode: 'Markdown',
              reply_markup: insufficientKeyboard,
            });
            return;
          }

          if (
            typeof c.services.translationService?.getSetting === 'function' &&
            customServiceNameEnabled(c.services.translationService)
          ) {
            c.session.pendingCustomNamePurchase = { packageId: pkg.id };
            await c.conversation.enter('buyPackageCustomNameConversation');
            return;
          }

          let checkout;
          try {
            checkout = await c.services.purchaseCheckoutService.create({
              telegramId,
              kind: 'new_config',
              pkg: effectivePkg,
              promoCode: pendingPromo.promoCode,
              quotedAmount: displayedPrice,
            });
            trackFunnelEvent('checkout_start');
          } catch {
            await renderScreen(
              c,
              buildUserEmptyState(
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
            .row();
          if (pendingPromo.quote?.code) {
            confirmKeyboard
              .text(t(c, 'shop_change_promo_button'), `checkout:promo:${checkout.id}`)
              .text(t(c, 'shop_clear_promo_button'), `checkout:clear_promo:${checkout.id}`)
              .row();
          } else {
            confirmKeyboard
              .text(t(c, 'shop_apply_promo_button'), `checkout:promo:${checkout.id}`)
              .row();
          }
          confirmKeyboard.text(t(c, 'menu_back_shop'), 'nav:shop');

          await renderScreen(
            c,
            buildPurchaseCheckoutScreen(
              c,
              pkg,
              displayedPrice,
              pendingPromo.quote?.code,
              balance,
              liveDiscount
            ),
            {
              parse_mode: 'Markdown',
              reply_markup: confirmKeyboard,
            }
          );
        }
      )
      .row();
  }
}

export const shopMenu = new Menu<MenuContext>('shop-menu')
  .dynamic(async (ctx, range) => {
    if (!ctx.services) return;
    const activeDiscounts = await safeListActiveDiscounts(ctx.services.catalogDiscountService);

    if (ctx.session.activeShopCategory) {
      const categoryPackages = ctx.services.pricingService.getPackages(
        undefined,
        undefined,
        false,
        ctx.session.activeShopCategory
      );

      if (categoryPackages.length === 0) {
        range
          .text(
            (c) => t(c, 'shop_category_empty'),
            async () => {}
          )
          .row();
      } else {
        renderPackageButtons(range, categoryPackages, activeDiscounts);
      }

      range
        .text(
          (c) => t(c, 'shop_all_categories_button'),
          async (c) => {
            c.session.activeShopCategory = undefined;
            await renderScreen(c, await renderShopMenuText(c), {
              parse_mode: 'Markdown',
              reply_markup: shopMenu,
            });
          }
        )
        .row();
    } else {
      const categories = (await ctx.services.packageCategoryService?.listCategories(false)) ?? [];
      const allPackages = ctx.services.pricingService.getPackages();
      const nonEmptyCategories = categories.filter((cat) =>
        allPackages.some((pkg) => pkg.categoryId === cat.id)
      );

      for (const cat of nonEmptyCategories) {
        const count = allPackages.filter((pkg) => pkg.categoryId === cat.id).length;
        const label = `${cat.icon ? `${cat.icon} ` : '📦 '}${cat.name} · ${localizedNumber(count, ctx)}`;
        range
          .text(label, async (c) => {
            c.session.activeShopCategory = cat.id;
            await renderScreen(c, await renderShopMenuText(c), {
              parse_mode: 'Markdown',
              reply_markup: shopMenu,
            });
          })
          .row();
      }

      const uncategorizedPackages =
        nonEmptyCategories.length > 0
          ? ctx.services.pricingService.getPackages(undefined, undefined, false, null)
          : allPackages;

      renderPackageButtons(range, uncategorizedPackages, activeDiscounts);

      if (customVolumeEnabled(ctx.services.translationService)) {
        const customPricePerGb = ctx.services.translationService.getSettingNum(
          'price_per_gb',
          5000
        );
        range
          .text(
            (c) => t(c, 'menu_custom_amount', { price: localizedNumber(customPricePerGb, c) }),
            async (c) => {
              if (!c.services || !customVolumeEnabled(c.services.translationService)) {
                await renderScreen(c, t(c, 'custom_volume_unavailable'), {
                  reply_markup: backKeyboard(c, 'main'),
                });
                return;
              }
              if (await enforcePurchasePhoneGate(c, 'custom_amount')) {
                return;
              }
              await c.conversation.enter('customAmountConversation');
            }
          )
          .row();
      }
    }

    if (ctx.session.pendingPromo) {
      range
        .text(
          (c) => `${t(c, 'shop_clear_promo_button')} · ${c.session.pendingPromo?.code}`,
          async (c) => {
            delete c.session.pendingPromo;
            await c.answerCallbackQuery({ text: t(c, 'button_refreshed') });
            await renderScreen(c, await renderShopMenuText(c), {
              parse_mode: 'Markdown',
              reply_markup: shopMenu,
            });
          }
        )
        .row();
    }
  })
  .row()
  .text(
    (ctx) => t(ctx, 'menu_back_main'),
    async (ctx) => {
      ctx.session.activeShopCategory = undefined;
      ctx.menu.nav('main-menu');
      await renderScreen(ctx, await renderHomeDashboard(ctx), { parse_mode: 'Markdown' });
    }
  );

// ── Wallet Statement Renderer ───────────────────────────────────────────────

export async function renderWalletStatementScreen(
  ctx: MenuContext,
  requestedPage = 1
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId || !ctx.services) return;

  const result = await ctx.services.walletService.listTransactionsForUser(
    telegramId,
    requestedPage,
    5
  );
  if (result.transactions.length === 0) {
    await renderScreen(
      ctx,
      buildUserEmptyState('📜', t(ctx, 'wallet_history_title'), t(ctx, 'wallet_history_empty')),
      { parse_mode: 'Markdown', reply_markup: backKeyboard(ctx, 'wallet') }
    );
    return;
  }

  const keyboard = new InlineKeyboard();
  if (result.totalPages > 1) {
    if (result.page > 1) {
      keyboard.text(t(ctx, 'pagination_previous'), `wallet:history:page:${result.page - 1}`);
    }
    keyboard.text(
      `${localizedNumber(result.page, ctx)} / ${localizedNumber(result.totalPages, ctx)}`,
      'ui:noop'
    );
    if (result.page < result.totalPages) {
      keyboard.text(t(ctx, 'pagination_next'), `wallet:history:page:${result.page + 1}`);
    }
    keyboard.row();
  }
  keyboard.text(t(ctx, 'menu_back_wallet'), 'nav:wallet');

  const typeIcon = (type: string, amount: number) => {
    switch (type) {
      case 'topup':
        return '➕';
      case 'topup_void':
        return '🚫';
      case 'purchase':
        return '🛍️';
      case 'refund':
        return '↩️';
      case 'referral_bonus':
        return '🎁';
      case 'cashback':
        return '💸';
      case 'transfer_sent':
        return '📤';
      case 'transfer_received':
        return '📥';
      case 'promo':
        return '🎟️';
      case 'lucky_wheel':
        return '🎡';
      default:
        return amount >= 0 ? '➕' : '➖';
    }
  };

  const TRANSACTION_TYPE_MAP: Record<string, string> = {
    topup: 'tx_type_topup',
    topup_void: 'tx_type_topup_void',
    purchase: 'tx_type_purchase',
    refund: 'tx_type_refund',
    admin_adjustment: 'tx_type_admin_adjustment',
    promo: 'tx_type_promo',
    referral_bonus: 'tx_type_referral_bonus',
    cashback: 'tx_type_cashback',
    trial: 'tx_type_trial',
    transfer_sent: 'tx_type_transfer_sent',
    transfer_received: 'tx_type_transfer_received',
    lucky_wheel: 'tx_type_lucky_wheel',
  };

  const screen = buildUserScreen({
    emoji: '📜',
    title: t(ctx, 'wallet_history_title'),
    subtitle: t(ctx, 'wallet_dashboard_subtitle'),
    sections: [
      {
        fields: result.transactions.map((tx) => {
          const icon = typeIcon(tx.type, tx.amount);
          const sign = tx.amount > 0 ? '+' : '';
          const typeKey = TRANSACTION_TYPE_MAP[tx.type];
          const typeLabel = typeKey ? t(ctx, typeKey) : escapeTelegramMarkdown(tx.type);
          const amountText = `${sign}${localizedNumber(tx.amount, ctx)} ${t(ctx, 'currency_toman')}`;
          const balanceAfterText = `${localizedNumber(tx.balanceAfter, ctx)} ${t(ctx, 'currency_toman')}`;
          return {
            emoji: icon,
            value: `*${typeLabel}* · ${localizedDate(new Date(tx.createdAt), ctx)}\n  *${amountText}* · ${t(ctx, 'wallet_available_balance')}: ${balanceAfterText}`,
          };
        }),
      },
    ],
    footer: t(ctx, 'subscription_list_page', {
      page: localizedNumber(result.page, ctx),
      total_pages: localizedNumber(result.totalPages, ctx),
    }),
  });

  await renderScreen(ctx, screen, { parse_mode: 'Markdown', reply_markup: keyboard });
}

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
      ctx.session.promoReturnDestination = 'wallet';
      await ctx.conversation.enter('promoConversation');
    }
  )
  .row()
  .text(
    (ctx) => t(ctx, 'wallet_history_button'),
    async (ctx) => {
      await renderWalletStatementScreen(ctx, 1);
    }
  )
  .dynamic((ctx, range) => {
    const transferEnabled = !ctx.services || walletTransferEnabled(ctx.services.translationService);
    if (transferEnabled) {
      range.text(
        (c) => t(c, 'menu_wallet_transfer'),
        async (c) => {
          await c.conversation.enter('transferBalanceConversation');
        }
      );
    }
  })
  .row()
  .text(
    (ctx) => t(ctx, 'menu_back_main'),
    async (ctx) => {
      ctx.menu.nav('main-menu');
      await renderScreen(ctx, await renderHomeDashboard(ctx), { parse_mode: 'Markdown' });
    }
  );

// Register submenus
mainMenu.register(shopMenu);
mainMenu.register(walletMenu);
