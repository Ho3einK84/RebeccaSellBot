import { InlineKeyboard, InputFile, type Bot } from 'grammy';
import QRCode from 'qrcode';
import type { MenuContext, UiMessageRole } from '../../types.js';
import { callbackData } from '../../callbackData.js';
import {
  formatPackageButtonLabel,
  formatSubscriptionLink,
  localizedDate,
  localizedNumber,
  localizedPackageName,
  resolveContextLocale,
  t,
  tm,
} from '../../locale.js';
import {
  backKeyboard,
  backToKeyboard,
  buildStatusBadge,
  buildUserEmptyState,
  buildUserScreen,
  dismissKeyboard,
  rememberArtifactMessage,
  renderScreen,
  renderSleekProgressBar,
  type StatusType,
} from '../../ui.js';
import { trackFunnelEvent } from '../../../domain/services/FunnelTelemetry.js';
import { acquireUserActionCooldown } from '../../middleware/actionCooldown.js';
import { clearPendingPromo, getPendingPromoPricing } from '../../promoSelection.js';
import { purchaseFailureMessage } from '../../purchaseFeedback.js';
import type { ConfigService } from '../../../domain/services/ConfigService.js';
import {
  customVolumeEnabled,
  renewalRolloverEnabled,
} from '../../../domain/services/FeatureSettings.js';
import { calculateTraffic } from '../../../domain/services/ConfigLifecycle.js';
import { RefundOutcomePendingError } from '../../../domain/services/RefundService.js';
import { PurchaseCheckoutUnavailableError } from '../../../domain/services/PurchaseCheckoutService.js';
import {
  type RebeccaUserDetail,
  RebeccaOriginDownError,
} from '../../../domain/services/RebeccaService.js';
import {
  resolveBestCatalogDiscount,
  safeListActiveDiscounts,
  type CatalogDiscountRow,
  type ResolvedCatalogDiscount,
} from '../../../domain/services/CatalogDiscountService.js';
import {
  applyGroupDiscount,
  formatRemainingDiscountDuration,
  type PackageOption,
} from '../../../domain/services/PricingService.js';
import {
  formatUserGroupDisplayLabel,
  safeGetEffectiveUserPolicy,
  type EffectiveUserGroupPolicy,
} from '../../../domain/services/UserGroupService.js';
import { escapeTelegramMarkdown, sanitizeTelegramInlineCode } from '../../rendering.js';
import {
  formatConfigButtonTitle,
  formatTelegramConfigRef,
} from '../../../domain/services/TelegramFormatting.js';
import { packageCatalogToken } from '../../packageCatalog.js';
import { recordCheckoutCompleted, recordCheckoutFailed } from '../../checkoutLifecycle.js';
import {
  buildInsufficientBalanceKeyboard,
  buildUnifiedCheckoutScreen,
  buildUnifiedInsufficientBalanceScreen,
  computeRolloverPreview,
  formatCompactDiscountedPackageLabel,
  type RolloverPreview,
} from '../../checkoutRenderer.js';

const SUBSCRIPTION_PAGE_SIZE = 4;
const CONFIG_ID_CAPTURE = '([a-zA-Z0-9_]{3,40})';
export type UserConfigRecord = NonNullable<Awaited<ReturnType<ConfigService['getConfigById']>>>;
type SubscriptionSnapshot = {
  remote?: RebeccaUserDetail;
  status: string;
  statusLabel: string;
  remaining: string;
  expiryInfo: string;
  onlineInfo: string;
  createdInfo: string;
  subUrl?: string;
  autoRenewPackageName?: string;
};
export type DeleteQuote =
  | {
      eligible: true;
      grossAmount: number;
      cashbackWithheld: number;
      refundAmount: number;
    }
  | { eligible: false; reason: string };

function applyPendingPromoToPrice(
  basePrice: number,
  pendingPromo?: MenuContext['session']['pendingPromo']
): number {
  if (!pendingPromo) return basePrice;
  if (pendingPromo.minPurchaseAmount && basePrice < pendingPromo.minPurchaseAmount) {
    return basePrice;
  }
  if (pendingPromo.type === 'discount_percent') {
    let discount = Math.floor((basePrice * pendingPromo.value) / 100);
    if (
      pendingPromo.maxDiscountAmount !== undefined &&
      pendingPromo.maxDiscountAmount !== null &&
      pendingPromo.maxDiscountAmount > 0
    ) {
      discount = Math.min(discount, pendingPromo.maxDiscountAmount);
    }
    return Math.max(0, basePrice - discount);
  }
  if (pendingPromo.type === 'discount_fixed') {
    return Math.max(0, basePrice - pendingPromo.value);
  }
  return basePrice;
}

export function buildRenewalSelectionKeyboard(
  ctx: MenuContext,
  configId: string,
  panelId?: string,
  serviceId?: number,
  activeDiscounts: readonly CatalogDiscountRow[] = [],
  userPolicy?: EffectiveUserGroupPolicy | null
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const packages = ctx.services!.pricingService.getPackages(panelId, serviceId);
  const catalogToken = packageCatalogToken(packages);
  const allowPromo = userPolicy?.allowPromoCodes ?? true;
  const allowCatalog = userPolicy?.allowCatalogDiscounts ?? true;
  const pendingPromo = allowPromo ? ctx.session?.pendingPromo : undefined;
  for (const [index, pkg] of packages.entries()) {
    const groupDisc = applyGroupDiscount(pkg.price, userPolicy?.discountPercent);
    const catalogDiscount = allowCatalog
      ? resolveBestCatalogDiscount(activeDiscounts, {
          packageId: pkg.id,
          categoryId: pkg.categoryId ?? null,
          originalPrice: groupDisc.finalAmount,
        })
      : {
          originalPrice: groupDisc.finalAmount,
          effectivePrice: groupDisc.finalAmount,
          discountAmount: 0,
          activeDiscountId: null,
          activeDiscountTitle: null,
          discountExpiresAt: null,
        };
    const effectivePrice = applyPendingPromoToPrice(catalogDiscount.effectivePrice, pendingPromo);
    keyboard
      .text(
        formatCompactDiscountedPackageLabel(ctx, pkg, {
          effectivePrice,
          catalogDiscount,
        }),
        callbackData('r', 'p', configId, index, catalogToken)
      )
      .row();
  }
  if (customVolumeEnabled(ctx.services!.translationService)) {
    const rawRate =
      userPolicy?.customPricePerGb ??
      ctx.services!.translationService.getSettingNum('price_per_gb', 5_000);
    const pricePerGb = applyGroupDiscount(rawRate, userPolicy?.discountPercent).finalAmount;
    keyboard
      .text(
        t(ctx, 'renew_custom_button', { price: localizedNumber(pricePerGb, ctx) }),
        callbackData('renew', 'custom', configId)
      )
      .row();
  }
  if (allowPromo) {
    if (pendingPromo) {
      keyboard
        .text(
          `${t(ctx, 'shop_clear_promo_button')} · ${pendingPromo.code}`,
          callbackData('renew', 'clear_promo', configId)
        )
        .row();
    } else {
      keyboard.text(t(ctx, 'shop_apply_promo_button'), 'shop:apply_promo').row();
    }
  }
  return keyboard.text(t(ctx, 'menu_back'), callbackData('config', 'view', configId));
}

export async function showUserSubscriptions(
  ctx: MenuContext,
  requestedPage?: number
): Promise<void> {
  if (!ctx.services || !ctx.from?.id) return;
  const targetPage = requestedPage ?? ctx.session?.subscriptionListPage ?? 1;
  const configs = await ctx.services.configService.listConfigsForOwner(ctx.from.id);
  if (configs.length === 0) {
    await renderSubscriptionScreen(
      ctx,
      buildUserEmptyState(
        '📭',
        t(ctx, 'subscription_list_empty_title'),
        t(ctx, 'subscription_list_empty_body'),
        t(ctx, 'subscription_list_empty_action')
      ),
      new InlineKeyboard()
        .text(t(ctx, 'menu_buy_subscription'), 'nav:shop')
        .row()
        .text(t(ctx, 'menu_back_main'), 'nav:main')
    );
    return;
  }
  const totalPages = Math.max(1, Math.ceil(configs.length / SUBSCRIPTION_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(targetPage)), totalPages);
  if (ctx.session) {
    ctx.session.subscriptionListPage = page;
  }
  const pageConfigs = configs.slice(
    (page - 1) * SUBSCRIPTION_PAGE_SIZE,
    page * SUBSCRIPTION_PAGE_SIZE
  );
  const cards = await Promise.all(
    pageConfigs.map((config) =>
      buildSubscriptionSnapshot(ctx, config, { includeProgressBars: false })
    )
  );
  const navigation = new InlineKeyboard();
  for (const [index, config] of pageConfigs.entries()) {
    const card = cards[index]!;
    navigation
      .text(
        `${statusEmoji(card.status)} ${formatConfigButtonTitle(config.configUsername, config.userLabel)}`,
        callbackData('config', 'view', config.id)
      )
      .row();
  }
  if (totalPages > 1) {
    if (page > 1) navigation.text(t(ctx, 'pagination_previous'), `subs:page:${page - 1}`);
    navigation.text(
      `${localizedNumber(page, ctx)} / ${localizedNumber(totalPages, ctx)}`,
      'ui:noop'
    );
    if (page < totalPages) navigation.text(t(ctx, 'pagination_next'), `subs:page:${page + 1}`);
    navigation.row();
  }
  navigation.text(t(ctx, 'menu_back_main'), 'nav:main');
  await renderSubscriptionScreen(
    ctx,
    buildUserScreen({
      emoji: '📡',
      title: t(ctx, 'subscription_list_title'),
      subtitle: t(ctx, 'subscription_list_subtitle'),
      primary: {
        label: t(ctx, 'subscription_list_total_label'),
        value: `${localizedNumber(configs.length, ctx)} ${t(ctx, 'service_unit')}`,
        inline: true,
        emphasizeValue: true,
      },
      sections: pageConfigs.map((config, index) => {
        const card = cards[index]!;
        return {
          emoji: statusEmoji(card.status),
          title: formatTelegramConfigRef(config.configUsername, config.userLabel),
          fields: [
            {
              label: t(ctx, 'subscription_status_label'),
              value: card.statusLabel,
            },
            { label: t(ctx, 'remaining'), value: card.remaining },
            { label: t(ctx, 'expiry'), value: card.expiryInfo },
          ],
        };
      }),
      footer: t(ctx, 'subscription_list_page', {
        page: localizedNumber(page, ctx),
        total_pages: localizedNumber(totalPages, ctx),
      }),
    }),
    navigation
  );
}

/** Render the current owned detail card; useful for refreshing legacy callbacks safely. */
export async function showSubscriptionDetail(
  ctx: MenuContext,
  configId: string,
  answerIfMissing = true
): Promise<boolean> {
  const config = await ownedConfig(ctx, configId, answerIfMissing);
  if (!config) return false;
  const card = await buildSubscriptionCard(ctx, config, true);
  await renderSubscriptionScreen(ctx, card.text, card.keyboard);
  return true;
}

export async function renderRenewalSelection(
  ctx: MenuContext,
  config: UserConfigRecord
): Promise<void> {
  const targetTelegramId = config.telegramId;
  const userPolicy = await safeGetEffectiveUserPolicy(
    ctx.services!.userGroupService,
    targetTelegramId
  );
  const packages = ctx.services!.pricingService.getPackages(config.panelId, config.serviceId);
  const activeDiscounts = userPolicy.allowCatalogDiscounts
    ? await safeListActiveDiscounts(ctx.services!.catalogDiscountService)
    : [];
  const isCustom = customVolumeEnabled(ctx.services!.translationService);
  const keyboard = buildRenewalSelectionKeyboard(
    ctx,
    config.id,
    config.panelId,
    config.serviceId,
    activeDiscounts,
    userPolicy
  );
  const hasChoices = packages.length > 0 || isCustom;

  let availableBalance: number | undefined;
  try {
    const ws = ctx.services!.walletService;
    if (typeof ws?.getAvailableBalance === 'function') {
      availableBalance = await ws.getAvailableBalance(targetTelegramId);
    } else if (typeof ws?.getBalance === 'function') {
      availableBalance = await ws.getBalance(targetTelegramId);
    }
  } catch {
    availableBalance = undefined;
  }

  let featuredDiscount: ResolvedCatalogDiscount | undefined;
  if (userPolicy.allowCatalogDiscounts) {
    for (const pkg of packages) {
      const groupPrice = applyGroupDiscount(pkg.price, userPolicy.discountPercent).finalAmount;
      const resolved = resolveBestCatalogDiscount(activeDiscounts, {
        packageId: pkg.id,
        categoryId: pkg.categoryId ?? null,
        originalPrice: groupPrice,
      });
      if (
        resolved.discountAmount > 0 &&
        (!featuredDiscount || resolved.discountAmount > featuredDiscount.discountAmount)
      ) {
        featuredDiscount = resolved;
      }
    }
  }

  const traffic = calculateTraffic(undefined, config);
  const currentFields: Array<{ emoji?: string; label?: string; value: string }> = [];
  const groupLabel = formatUserGroupDisplayLabel(userPolicy);
  if (groupLabel) {
    currentFields.push({
      emoji: '🏷️',
      label: t(ctx, 'user_group_badge_label'),
      value:
        userPolicy.discountPercent > 0
          ? `${escapeTelegramMarkdown(groupLabel)} (-${localizedNumber(userPolicy.discountPercent, ctx)}%)`
          : escapeTelegramMarkdown(groupLabel),
    });
  }
  if (availableBalance !== undefined) {
    currentFields.push({
      emoji: '💳',
      label: t(ctx, 'shop_wallet_balance_label'),
      value: `${localizedNumber(availableBalance, ctx)} ${t(ctx, 'currency_toman')}`,
    });
    if (userPolicy.creditLimit > 0) {
      currentFields.push({
        emoji: '🛒',
        label: t(ctx, 'wallet_purchasing_power_label'),
        value: `${localizedNumber(Math.max(0, availableBalance + userPolicy.creditLimit), ctx)} ${t(ctx, 'currency_toman')}`,
      });
    }
  }
  if (!traffic.isUnavailable) {
    const remValue = traffic.isUnlimited
      ? t(ctx, 'unlimited')
      : traffic.remainingBytes != null
        ? `${localizedNumber(Number((traffic.remainingBytes / 1024 ** 3).toFixed(1)), ctx)} ${t(ctx, 'traffic_unit_gb')}`
        : undefined;
    if (remValue) {
      currentFields.push({ label: t(ctx, 'remaining'), value: remValue });
    }
  }
  if (config.panelStatus === 'on_hold' || config.panelExpire != null) {
    currentFields.push({
      label: t(ctx, 'expiry'),
      value:
        config.panelStatus === 'on_hold'
          ? formatOnHoldExpiry(ctx, config.panelOnHoldExpireDuration)
          : formatExpiry(ctx, config.panelExpire),
    });
  }
  if (featuredDiscount?.activeDiscountTitle) {
    currentFields.push({
      value: t(ctx, 'shop_discount_banner', {
        name: escapeTelegramMarkdown(featuredDiscount.activeDiscountTitle),
        remaining: formatRemainingDiscountDuration(
          featuredDiscount.discountExpiresAt,
          resolveContextLocale(ctx)
        ),
      }),
    });
  }
  const pendingPromo = ctx.session?.pendingPromo;
  if (pendingPromo) {
    currentFields.push({
      emoji: '🎟️',
      label: t(ctx, 'shop_promo_section'),
      value: `\`${sanitizeTelegramInlineCode(pendingPromo.code)}\``,
    });
  }

  await renderSubscriptionScreen(
    ctx,
    buildUserScreen({
      emoji: '🔄',
      title: t(ctx, 'renewal_selection_title'),
      subtitle: t(ctx, 'renewal_selection_subtitle'),
      primary: {
        label: t(ctx, 'renewal_selection_service_label'),
        value: formatTelegramConfigRef(config.configUsername, config.userLabel),
        inline: true,
      },
      ...(currentFields.length > 0
        ? {
            sections: [
              {
                title: t(ctx, 'renewal_current_status_section'),
                fields: currentFields,
              },
            ],
          }
        : {}),
      footer: hasChoices
        ? t(ctx, 'renewal_selection_hint')
        : `⚠️ ${t(ctx, 'renewal_selection_empty')}`,
    }),
    keyboard
  );
}

/**
 * Shared renewal checkout preview renderer used both on direct package pick
 * and when resuming a renewal after applying/clearing a promo code.
 */
export async function renderRenewalCheckoutForPackage(
  ctx: MenuContext,
  configId: string,
  packageId: string
): Promise<boolean> {
  const config = await ownedConfig(ctx, configId, false);
  if (!config || !ctx.services) return false;
  const packages = ctx.services.pricingService.getPackages(config.panelId, config.serviceId);
  const pkg = packages.find((item) => item.id === packageId);
  if (!pkg) return false;

  await renderRenewalCheckoutForResolvedPackage(ctx, config, pkg);
  return true;
}

async function renderRenewalCheckoutForResolvedPackage(
  ctx: MenuContext,
  config: UserConfigRecord,
  pkg: PackageOption
): Promise<void> {
  const targetTelegramId = config.telegramId;
  const userPolicy = await safeGetEffectiveUserPolicy(
    ctx.services!.userGroupService,
    targetTelegramId
  );
  const groupDisc = applyGroupDiscount(pkg.price, userPolicy.discountPercent);
  const activeDiscounts = userPolicy.allowCatalogDiscounts
    ? await safeListActiveDiscounts(ctx.services!.catalogDiscountService)
    : [];
  const catalogDiscount = userPolicy.allowCatalogDiscounts
    ? resolveBestCatalogDiscount(activeDiscounts, {
        packageId: pkg.id,
        categoryId: pkg.categoryId ?? null,
        originalPrice: groupDisc.finalAmount,
      })
    : {
        originalPrice: groupDisc.finalAmount,
        effectivePrice: groupDisc.finalAmount,
        discountAmount: 0,
        activeDiscountId: null,
        activeDiscountTitle: null,
        discountExpiresAt: null,
      };
  const effectivePkg: PackageOption =
    catalogDiscount.effectivePrice !== pkg.price
      ? { ...pkg, price: catalogDiscount.effectivePrice }
      : pkg;

  if (!userPolicy.allowPromoCodes && ctx.session?.pendingPromo) {
    delete ctx.session.pendingPromo;
  }
  const pendingPromo = userPolicy.allowPromoCodes
    ? await getPendingPromoPricing(ctx, targetTelegramId, effectivePkg.price, pkg.gbAmount)
    : {};
  if (pendingPromo.messageKey) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'promo_no_longer_usable'), show_alert: true });
    }
    await renderSubscriptionScreen(
      ctx,
      buildUserEmptyState('⚠️', t(ctx, 'renewal_selection_title'), t(ctx, pendingPromo.messageKey)),
      new InlineKeyboard().text(t(ctx, 'menu_back'), callbackData('renew', 'open', config.id))
    );
    return;
  }

  const price = pendingPromo.quote?.finalAmount ?? effectivePkg.price;
  const bonusGb = pendingPromo.quote
    ? Math.max(0, pendingPromo.quote.finalGbAmount - pkg.gbAmount)
    : 0;
  const balance = await ctx.services!.walletService.getAvailableBalance(targetTelegramId);
  const purchasingPower = Math.max(0, balance + userPolicy.creditLimit);

  if (ctx.session) {
    ctx.session.promoCheckoutContext = {
      kind: 'renew_config',
      configId: config.id,
      packageId: pkg.id,
    };
  }

  if (purchasingPower < price) {
    if (ctx.session) {
      ctx.session.pendingTopupIntent = {
        kind: 'renew_config',
        packageId: pkg.id,
        configId: config.id,
        configUsername: config.configUsername,
        deficitAmount: price - purchasingPower,
        createdAt: Date.now(),
      };
    }
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'insufficient_balance'), show_alert: true });
    }
    await renderSubscriptionScreen(
      ctx,
      buildUnifiedInsufficientBalanceScreen(ctx, {
        packagePrice: price,
        balance,
        creditLimit: userPolicy.creditLimit,
        includePromoHint: userPolicy.allowPromoCodes,
      }),
      buildInsufficientBalanceKeyboard(ctx, {
        backLabelKey: 'menu_back',
        backCallback: callbackData('renew', 'open', config.id),
        ...(userPolicy.allowPromoCodes ? { promoCallback: 'shop:apply_promo' } : {}),
      })
    );
    return;
  }

  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery().catch(() => undefined);
  }
  const checkout = await ctx.services!.purchaseCheckoutService.create({
    telegramId: targetTelegramId,
    kind: 'renew_config',
    configId: config.id,
    pkg: effectivePkg,
    panelId: config.panelId,
    serviceId: pkg.serviceId ?? config.serviceId,
    promoCode: pendingPromo.promoCode,
    quotedAmount: price,
  });

  const rolloverEnabled =
    pkg.rolloverQuota ??
    (typeof ctx.services!.translationService?.getSetting === 'function'
      ? renewalRolloverEnabled(ctx.services!.translationService)
      : true);

  let remote: RebeccaUserDetail | undefined;
  if (rolloverEnabled && typeof ctx.services!.configService?.getRemoteConfigDetail === 'function') {
    try {
      remote = await ctx.services!.configService.getRemoteConfigDetail(config);
    } catch {
      remote = undefined;
    }
  }
  const rollover = computeRolloverPreview({
    enabled: rolloverEnabled,
    addedGb: pkg.gbAmount,
    addedDays: pkg.durationDays,
    dataLimitBytes: remote?.data_limit ?? config.panelDataLimit,
    usedTrafficBytes: remote?.used_traffic ?? config.panelUsedTraffic,
    expireTimestampSec: remote?.expire ?? config.panelExpire,
    status: remote?.status ?? config.panelStatus,
    onHoldExpireDurationSec:
      remote?.on_hold_expire_duration ?? config.panelOnHoldExpireDuration ?? null,
  });

  const confirmKeyboard = new InlineKeyboard()
    .text(t(ctx, 'renew_confirm_button'), callbackData('renew', 'confirm', checkout.id))
    .row();
  if (userPolicy.allowPromoCodes) {
    if (pendingPromo.quote?.code) {
      confirmKeyboard
        .text(t(ctx, 'shop_change_promo_button'), `checkout:promo:${checkout.id}`)
        .text(t(ctx, 'shop_clear_promo_button'), `checkout:clear_promo:${checkout.id}`)
        .row();
    } else {
      confirmKeyboard
        .text(t(ctx, 'shop_apply_promo_button'), `checkout:promo:${checkout.id}`)
        .row();
    }
  }
  confirmKeyboard.text(t(ctx, 'menu_back'), callbackData('renew', 'open', config.id));

  await renderSubscriptionScreen(
    ctx,
    buildRenewalCheckoutScreen(ctx, {
      username: config.configUsername,
      serviceLabel: config.userLabel ?? null,
      packageName: localizedPackageName(ctx, pkg.id, pkg.name),
      gbAmount: pkg.gbAmount,
      bonusGb,
      durationDays: pkg.durationDays,
      amount: price,
      originalPrice: pkg.price,
      effectivePrice: effectivePkg.price,
      pricePerGb: pkg.gbAmount + bonusGb > 0 ? Math.round(price / (pkg.gbAmount + bonusGb)) : price,
      walletBalance: balance,
      creditLimit: userPolicy.creditLimit,
      groupLabel: formatUserGroupDisplayLabel(userPolicy),
      groupDiscountPercent: groupDisc.discountPercent,
      groupDiscountAmount: groupDisc.discountAmount,
      catalogDiscount,
      promoCode: pendingPromo.quote?.code,
      rolloverEnabled,
      rollover,
    }),
    confirmKeyboard
  );
}

async function renderAutoRenewSelection(ctx: MenuContext, config: UserConfigRecord): Promise<void> {
  if (!ctx.services) return;
  const userPolicy = await safeGetEffectiveUserPolicy(
    ctx.services.userGroupService,
    config.telegramId
  );
  const packages = ctx.services.pricingService.getPackages(config.panelId, config.serviceId);
  const catalogToken = packageCatalogToken(packages);
  const keyboard = new InlineKeyboard();
  for (const [index, pkg] of packages.entries()) {
    const effectivePrice = applyGroupDiscount(pkg.price, userPolicy.discountPercent).finalAmount;
    keyboard
      .text(
        formatPackageButtonLabel(ctx, pkg, { effectivePrice }),
        callbackData('ar', 'p', config.id, index, catalogToken)
      )
      .row();
  }
  const isCustom = customVolumeEnabled(ctx.services.translationService);
  if (isCustom) {
    const rawRate =
      userPolicy.customPricePerGb ??
      ctx.services.translationService.getSettingNum('price_per_gb', 5_000);
    const pricePerGb = applyGroupDiscount(rawRate, userPolicy.discountPercent).finalAmount;
    keyboard
      .text(
        t(ctx, 'renew_custom_button', { price: localizedNumber(pricePerGb, ctx) }),
        callbackData('autorenew', 'custom', config.id)
      )
      .row();
  }
  const hasChoices = packages.length > 0 || isCustom;
  keyboard.text(t(ctx, 'menu_back'), callbackData('config', 'view', config.id));
  await renderSubscriptionScreen(
    ctx,
    buildUserScreen({
      emoji: '♻️',
      title: t(ctx, 'auto_renew_selection_title'),
      subtitle: t(ctx, 'auto_renew_selection_subtitle'),
      primary: {
        label: t(ctx, 'renewal_selection_service_label'),
        value: formatTelegramConfigRef(config.configUsername, config.userLabel),
        inline: true,
      },
      footer: hasChoices
        ? t(ctx, 'auto_renew_selection_hint')
        : `⚠️ ${t(ctx, 'renewal_selection_empty')}`,
    }),
    keyboard
  );
}

export function registerSubscriptionRoutes(bot: Bot<MenuContext>): void {
  bot.callbackQuery(/^subs:page:(\d+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery({ text: t(ctx, 'subscriptions_loading') });
    await showUserSubscriptions(ctx, Number(ctx.match[1]) || 1);
  });

  bot.callbackQuery(new RegExp(`^renew:open:${CONFIG_ID_CAPTURE}$`, 'u'), async (ctx) => {
    const config = await ownedConfig(ctx, ctx.match[1]!);
    if (!config) return;
    if (!acquireUserActionCooldown(ctx.from.id, 'renewal', 2_000)) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'renewal_in_progress') });
      return;
    }
    await ctx.answerCallbackQuery();
    await renderRenewalSelection(ctx, config);
  });

  bot.callbackQuery(new RegExp(`^renew:clear_promo:${CONFIG_ID_CAPTURE}$`, 'u'), async (ctx) => {
    const config = await ownedConfig(ctx, ctx.match[1]!);
    if (!config) return;
    clearPendingPromo(ctx);
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await renderRenewalSelection(ctx, config);
  });

  bot.callbackQuery(
    new RegExp(`^r:p:${CONFIG_ID_CAPTURE}:(\\d+):([0-9a-f]{10})$`, 'u'),
    async (ctx) => {
      const config = await ownedConfig(ctx, ctx.match[1]!);
      if (!config) return;
      const packageIndex = Number(ctx.match[2]);
      const packages = ctx.services!.pricingService.getPackages(config.panelId, config.serviceId);
      const pkg =
        ctx.match[3] === packageCatalogToken(packages) && Number.isSafeInteger(packageIndex)
          ? packages[packageIndex]
          : undefined;
      if (!pkg) {
        await ctx.answerCallbackQuery({
          text: t(ctx, 'renewal_package_missing'),
          show_alert: true,
        });
        return;
      }
      await renderRenewalCheckoutForResolvedPackage(ctx, config, pkg);
    }
  );

  // Package-index callbacks from old screens cannot prove which catalog the
  // user reviewed. Refresh the current list instead of creating a checkout.
  bot.callbackQuery(new RegExp(`^renew:package:${CONFIG_ID_CAPTURE}:(\\d+)$`, 'u'), async (ctx) => {
    const config = await ownedConfig(ctx, ctx.match[1]!);
    if (!config) return;
    await ctx.answerCallbackQuery({
      text: t(ctx, 'purchase_confirmation_expired'),
      show_alert: true,
    });
    await renderRenewalSelection(ctx, config);
  });

  bot.callbackQuery(/^renew:confirm:(co_[A-Za-z0-9_-]{8,32})$/u, async (ctx) => {
    if (!ctx.services) return;
    const isAdmin = Boolean(
      ctx.from && typeof ctx.services?.isAdmin === 'function' && ctx.services.isAdmin(ctx.from.id)
    );
    let checkout;
    try {
      checkout = await ctx.services.purchaseCheckoutService.claim(
        ctx.match[1]!,
        ctx.from.id,
        isAdmin
      );
    } catch (error) {
      await ctx.answerCallbackQuery({
        text: t(
          ctx,
          error instanceof PurchaseCheckoutUnavailableError
            ? 'purchase_confirmation_expired'
            : 'button_action_failed'
        ),
        show_alert: true,
      });
      return;
    }
    const config = checkout.configId
      ? isAdmin
        ? await ctx.services.configService.getConfigById(checkout.configId)
        : await ctx.services.configService.getOwnedConfigById(ctx.from.id, checkout.configId)
      : undefined;
    if (!config || config.panelId !== checkout.panelId) {
      await recordCheckoutFailed(ctx.services.purchaseCheckoutService, checkout.id);
      await ctx.answerCallbackQuery({ text: t(ctx, 'config_not_owned'), show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: t(ctx, 'renewing') });
    await renderSubscriptionScreen(
      ctx,
      buildUserScreen({
        emoji: '⏳',
        title: t(ctx, 'renewal_processing_title'),
        subtitle: t(ctx, 'renewal_processing_subtitle'),
        primary: {
          label: t(ctx, 'renewal_selection_service_label'),
          value: formatTelegramConfigRef(config.configUsername, config.userLabel),
          inline: true,
        },
      }),
      new InlineKeyboard().text(t(ctx, 'operation_in_progress'), 'purchase:pending')
    );
    let result: { configUsername: string; subUrl?: string };
    try {
      const resolvedPkg =
        typeof ctx.services.pricingService?.getPackageById === 'function'
          ? ctx.services.pricingService.getPackageById(checkout.packageId)
          : undefined;
      result = await ctx.services!.walletService.executePurchaseSaga({
        telegramId: checkout.telegramId,
        amount: checkout.amount,
        maxAmount: checkout.quotedAmount,
        type: 'renew_config',
        configUsername: config.configUsername,
        gbAmount: checkout.gbAmount,
        durationDays: checkout.durationDays,
        panelId: checkout.panelId,
        serviceId: checkout.serviceId,
        checkoutId: checkout.id,
        ...(checkout.promoCode ? { promoCode: checkout.promoCode } : {}),
        ...(resolvedPkg?.rolloverQuota !== undefined
          ? { rolloverQuota: resolvedPkg.rolloverQuota }
          : {}),
        allowAdminOverride: isAdmin,
      });
    } catch (err) {
      await recordCheckoutFailed(ctx.services.purchaseCheckoutService, checkout.id);
      if (checkout.promoCode) clearPendingPromo(ctx);
      const failureMarkup =
        isAdmin && config.telegramId !== ctx.from.id
          ? backToKeyboard(ctx, `admin:user:subscriptions:${config.telegramId}:1`)
          : new InlineKeyboard()
              .text(t(ctx, 'menu_back'), callbackData('renew', 'open', config.id))
              .row()
              .text(t(ctx, 'menu_back_main'), 'nav:main');
      await renderScreen(
        ctx,
        buildUserEmptyState(
          '⚠️',
          t(ctx, 'renewal_failed_title'),
          purchaseFailureMessage(ctx.services!.translationService, err, resolveContextLocale(ctx))
        ),
        { parse_mode: 'Markdown', reply_markup: failureMarkup }
      );
      return;
    }

    await recordCheckoutCompleted(ctx.services.purchaseCheckoutService, checkout.id);
    if (checkout.promoCode) clearPendingPromo(ctx);
    if (ctx.session) {
      delete ctx.session.promoCheckoutContext;
      delete ctx.session.pendingTopupIntent;
    }

    let updatedRemote: RebeccaUserDetail | undefined;
    if (typeof ctx.services.configService?.getRemoteConfigDetail === 'function') {
      try {
        updatedRemote = await ctx.services.configService.getRemoteConfigDetail(config);
      } catch {
        updatedRemote = undefined;
      }
    }
    let remainingBalance: number | undefined;
    try {
      const ws = ctx.services.walletService;
      if (typeof ws?.getAvailableBalance === 'function') {
        remainingBalance = await ws.getAvailableBalance(checkout.telegramId);
      }
    } catch {
      remainingBalance = undefined;
    }

    const successFields: Array<{ label: string; value: string }> = [
      {
        label: t(ctx, 'renewal_success_service_label'),
        value: formatTelegramConfigRef(result.configUsername, config.userLabel),
      },
      {
        label: t(ctx, 'renewal_success_package_label'),
        value: escapeTelegramMarkdown(
          localizedPackageName(ctx, checkout.packageId, checkout.packageName)
        ),
      },
    ];
    if (updatedRemote) {
      const updatedTraffic = calculateTraffic(updatedRemote, config);
      if (
        !updatedTraffic.isUnavailable &&
        !updatedTraffic.isUnlimited &&
        updatedTraffic.remainingBytes != null
      ) {
        successFields.push({
          label: t(ctx, 'renewal_success_new_quota_label'),
          value: `${localizedNumber(Number((updatedTraffic.remainingBytes / 1024 ** 3).toFixed(1)), ctx)} ${t(ctx, 'traffic_unit_gb')}`,
        });
      }
      if (updatedRemote.expire != null) {
        successFields.push({
          label: t(ctx, 'renewal_success_new_expiry_label'),
          value: formatExpiry(ctx, updatedRemote.expire),
        });
      }
    }
    if (remainingBalance !== undefined) {
      successFields.push({
        label: t(ctx, 'renewal_success_balance_label'),
        value: `${localizedNumber(remainingBalance, ctx)} ${t(ctx, 'currency_toman')}`,
      });
    }

    const successMarkup =
      isAdmin && config.telegramId !== ctx.from.id
        ? backToKeyboard(ctx, `admin:user:subscriptions:${config.telegramId}:1`)
        : new InlineKeyboard()
            .text(t(ctx, 'subscription_view_detail'), callbackData('config', 'view', config.id))
            .row()
            .text(t(ctx, 'menu_back_main'), 'nav:main');
    await renderSubscriptionScreen(
      ctx,
      buildUserScreen({
        emoji: '✅',
        title: t(ctx, 'renewal_success_title'),
        subtitle: t(ctx, 'renewal_success_subtitle'),
        sections: [
          {
            bullet: '',
            fields: successFields,
          },
        ],
      }),
      successMarkup
    );
  });

  bot.callbackQuery(new RegExp(`^renew:custom:${CONFIG_ID_CAPTURE}$`, 'u'), async (ctx) => {
    const config = await ownedConfig(ctx, ctx.match[1]!);
    if (!config) return;
    if (!customVolumeEnabled(ctx.services!.translationService)) {
      await ctx.answerCallbackQuery({
        text: t(ctx, 'custom_volume_unavailable'),
        show_alert: true,
      });
      return;
    }
    ctx.session.renewConfigId = config.id;
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('renewConfigConversation');
  });

  bot.callbackQuery(new RegExp(`^config:view:${CONFIG_ID_CAPTURE}$`, 'u'), async (ctx) => {
    await ctx.answerCallbackQuery({ text: t(ctx, 'subscriptions_loading') });
    trackFunnelEvent('service_first_view');
    await showSubscriptionDetail(ctx, ctx.match[1]!, false);
  });

  bot.callbackQuery(new RegExp(`^config:refresh:${CONFIG_ID_CAPTURE}$`, 'u'), async (ctx) => {
    const config = await ownedConfig(ctx, ctx.match[1]!);
    if (!config) return;
    await ctx.answerCallbackQuery({ text: t(ctx, 'subscription_refreshing') });
    const card = await buildSubscriptionCard(ctx, config, true);
    await renderSubscriptionScreen(ctx, card.text, card.keyboard);
  });

  bot.callbackQuery(new RegExp(`^autorenew:(on|off):${CONFIG_ID_CAPTURE}$`, 'u'), async (ctx) => {
    const enabled = ctx.match[1] === 'on';
    const config = await ownedConfig(ctx, ctx.match[2]!);
    if (!config) return;
    await ctx.answerCallbackQuery();

    if (!enabled) {
      delete ctx.session.pendingAutoRenew;
      await renderSubscriptionScreen(
        ctx,
        buildUserScreen({
          emoji: '♻️',
          title: t(ctx, 'auto_renew_disable_title'),
          subtitle: t(ctx, 'auto_renew_disable_subtitle'),
          primary: {
            label: t(ctx, 'renewal_selection_service_label'),
            value: formatTelegramConfigRef(config.configUsername, config.userLabel),
            inline: true,
          },
          footer: `⚠️ ${t(ctx, 'auto_renew_disable_consequence')}`,
        }),
        new InlineKeyboard()
          .text(t(ctx, 'user_confirm_button'), callbackData('autorenew', 'off_confirm', config.id))
          .row()
          .text(t(ctx, 'menu_back'), callbackData('config', 'view', config.id))
      );
      return;
    }

    await renderAutoRenewSelection(ctx, config);
  });

  bot.callbackQuery(new RegExp(`^autorenew:custom:${CONFIG_ID_CAPTURE}$`, 'u'), async (ctx) => {
    const config = await ownedConfig(ctx, ctx.match[1]!);
    if (!config) return;
    if (!customVolumeEnabled(ctx.services!.translationService)) {
      await ctx.answerCallbackQuery({
        text: t(ctx, 'custom_volume_unavailable'),
        show_alert: true,
      });
      return;
    }
    await ctx.answerCallbackQuery();
    ctx.session.pendingConfigId = config.id;
    await ctx.conversation.enter('autoRenewCustomConversation');
  });

  bot.callbackQuery(
    new RegExp(`^ar:p:${CONFIG_ID_CAPTURE}:(\\d+):([0-9a-f]{10})$`, 'u'),
    async (ctx) => {
      const config = await ownedConfig(ctx, ctx.match[1]!);
      if (!config) return;
      const packageIndex = Number(ctx.match[2]);
      const packages = ctx.services!.pricingService.getPackages(config.panelId, config.serviceId);
      const pkg =
        ctx.match[3] === packageCatalogToken(packages) && Number.isSafeInteger(packageIndex)
          ? packages[packageIndex]
          : undefined;
      if (!pkg) {
        await ctx.answerCallbackQuery({
          text: t(ctx, 'auto_renew_package_unavailable'),
          show_alert: true,
        });
        return;
      }
      const userPolicy = await safeGetEffectiveUserPolicy(
        ctx.services!.userGroupService,
        config.telegramId
      );
      const effectiveAutoRenewPrice = applyGroupDiscount(
        pkg.price,
        userPolicy.discountPercent
      ).finalAmount;
      ctx.session.pendingAutoRenew = {
        configId: config.id,
        packageId: pkg.id,
        price: effectiveAutoRenewPrice,
      };
      await ctx.answerCallbackQuery();
      await renderSubscriptionScreen(
        ctx,
        buildUserScreen({
          emoji: '♻️',
          title: t(ctx, 'auto_renew_review_title'),
          subtitle: t(ctx, 'auto_renew_review_subtitle'),
          primary: {
            label: t(ctx, 'auto_renew_charge_label'),
            value: `${localizedNumber(effectiveAutoRenewPrice, ctx)} ${t(ctx, 'currency_toman')}`,
            emphasizeValue: true,
          },
          sections: [
            {
              title: t(ctx, 'renewal_selection_service_label'),
              fields: [
                {
                  label: t(ctx, 'checkout_service_label'),
                  value: formatTelegramConfigRef(config.configUsername, config.userLabel),
                },
                {
                  label: t(ctx, 'renewal_success_package_label'),
                  value: escapeTelegramMarkdown(localizedPackageName(ctx, pkg.id, pkg.name)),
                },
              ],
            },
          ],
          footer: t(ctx, 'auto_renew_review_hint'),
        }),
        new InlineKeyboard()
          .text(t(ctx, 'user_confirm_button'), callbackData('autorenew', 'confirm', config.id))
          .row()
          .text(t(ctx, 'menu_back'), callbackData('config', 'view', config.id))
      );
    }
  );

  bot.callbackQuery(new RegExp(`^autorenew:pkg:${CONFIG_ID_CAPTURE}:(\\d+)$`, 'u'), async (ctx) => {
    const config = await ownedConfig(ctx, ctx.match[1]!);
    if (!config) return;
    await ctx.answerCallbackQuery({
      text: t(ctx, 'purchase_confirmation_expired'),
      show_alert: true,
    });
    await renderAutoRenewSelection(ctx, config);
  });

  bot.callbackQuery(new RegExp(`^autorenew:confirm:${CONFIG_ID_CAPTURE}$`, 'u'), async (ctx) => {
    const config = await ownedConfig(ctx, ctx.match[1]!);
    if (!config) return;
    const pending = ctx.session.pendingAutoRenew;
    delete ctx.session.pendingAutoRenew;
    if (!pending || pending.configId !== config.id) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'button_action_failed'), show_alert: true });
      return;
    }
    const userPolicy = await safeGetEffectiveUserPolicy(
      ctx.services!.userGroupService,
      config.telegramId
    );
    const pkg = ctx
      .services!.pricingService.getPackages(config.panelId, config.serviceId)
      .find(
        (item) =>
          item.id === pending.packageId &&
          applyGroupDiscount(item.price, userPolicy.discountPercent).finalAmount === pending.price
      );
    if (!pkg) {
      await ctx.answerCallbackQuery({
        text: t(ctx, 'auto_renew_package_unavailable'),
        show_alert: true,
      });
      return;
    }
    if (!acquireUserActionCooldown(ctx.from.id, `autorenew:${config.id}`, 1_000)) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
      return;
    }
    await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
    await ctx.services!.configService.setAutoRenew(
      config.telegramId,
      config.id,
      true,
      pkg.id,
      pending.price
    );
    await renderSubscriptionScreen(
      ctx,
      buildUserScreen({
        emoji: '✅',
        title: t(ctx, 'auto_renew_enabled_title'),
        subtitle: t(ctx, 'auto_renew_enabled_subtitle'),
        primary: {
          label: t(ctx, 'renewal_selection_service_label'),
          value: formatTelegramConfigRef(config.configUsername, config.userLabel),
          inline: true,
        },
      }),
      new InlineKeyboard().text(t(ctx, 'menu_back'), callbackData('config', 'view', config.id))
    );
  });

  bot.callbackQuery(
    new RegExp(`^autorenew:off_confirm:${CONFIG_ID_CAPTURE}$`, 'u'),
    async (ctx) => {
      const config = await ownedConfig(ctx, ctx.match[1]!);
      if (!config) return;
      if (!acquireUserActionCooldown(ctx.from.id, `autorenew:${config.id}`, 1_000)) {
        await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
        return;
      }
      await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
      await ctx.services!.configService.setAutoRenew(config.telegramId, config.id, false);
      await renderSubscriptionScreen(
        ctx,
        buildUserScreen({
          emoji: '✅',
          title: t(ctx, 'auto_renew_disabled_title'),
          subtitle: t(ctx, 'auto_renew_disabled_subtitle'),
          primary: {
            label: t(ctx, 'renewal_selection_service_label'),
            value: formatTelegramConfigRef(config.configUsername, config.userLabel),
            inline: true,
          },
        }),
        new InlineKeyboard().text(t(ctx, 'menu_back'), callbackData('config', 'view', config.id))
      );
    }
  );

  bot.callbackQuery(new RegExp(`^config:set:(on|off):${CONFIG_ID_CAPTURE}$`, 'u'), async (ctx) => {
    const enabled = ctx.match[1] === 'on';
    const config = await ownedConfig(ctx, ctx.match[2]!);
    if (!config) return;
    if (!acquireUserActionCooldown(ctx.from.id, `config-status:${config.id}`, 3_000)) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress'), show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
    try {
      if (enabled) {
        await ctx.services!.configService.enableConfig(config.configUsername, config.panelId);
      } else {
        await ctx.services!.configService.disableConfig(config.configUsername, config.panelId);
      }
      const card = await buildSubscriptionCard(ctx, config, true);
      await renderSubscriptionScreen(ctx, card.text, card.keyboard);
    } catch (err) {
      const message =
        err instanceof RebeccaOriginDownError
          ? t(ctx, 'config_action_panel_down')
          : t(ctx, 'config_action_failed');
      await renderSubscriptionScreen(
        ctx,
        buildUserEmptyState('⚠️', t(ctx, 'subscription_status_label'), message),
        backKeyboard(ctx)
      );
    }
  });

  // Old toggle callbacks did not encode intent. A stale click could therefore
  // undo a newer state, so refresh the current detail card without mutating it.
  bot.callbackQuery(new RegExp(`^config:toggle:${CONFIG_ID_CAPTURE}$`, 'u'), async (ctx) => {
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await showSubscriptionDetail(ctx, ctx.match[1]!, false);
  });

  bot.callbackQuery(new RegExp(`^config:revoke_prompt:${CONFIG_ID_CAPTURE}$`, 'u'), async (ctx) => {
    const config = await ownedConfig(ctx, ctx.match[1]!);
    if (!config) return;
    await ctx.answerCallbackQuery();
    await renderSubscriptionScreen(
      ctx,
      buildUserScreen({
        emoji: '🔄',
        title: t(ctx, 'subscription_revoke_title'),
        subtitle: t(ctx, 'subscription_revoke_subtitle'),
        primary: {
          label: t(ctx, 'renewal_selection_service_label'),
          value: formatTelegramConfigRef(config.configUsername, config.userLabel),
          inline: true,
        },
        footer: `⚠️ ${t(ctx, 'subscription_revoke_consequence')}`,
      }),
      new InlineKeyboard()
        .text(t(ctx, 'user_confirm_button'), callbackData('config', 'revoke_confirm', config.id))
        .row()
        .text(t(ctx, 'menu_back'), callbackData('config', 'view', config.id))
    );
  });

  bot.callbackQuery(
    new RegExp(`^config:revoke_confirm:${CONFIG_ID_CAPTURE}$`, 'u'),
    async (ctx) => {
      const config = await ownedConfig(ctx, ctx.match[1]!);
      if (!config) return;
      if (!acquireUserActionCooldown(ctx.from.id, `revoke:${config.id}`, 5_000)) {
        await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress'), show_alert: true });
        return;
      }
      await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
      try {
        const url = await ctx.services!.configService.revokeSubscription(
          config.configUsername,
          config.panelId
        );
        await renderSubscriptionScreen(
          ctx,
          buildUserScreen({
            emoji: '✅',
            title: t(ctx, 'subscription_revoke_success_title'),
            subtitle: t(ctx, 'subscription_revoke_success_subtitle'),
            primary: {
              emoji: '🔗',
              label: t(ctx, 'subscription_link_label'),
              value: formatSubscriptionLink(url, t(ctx, 'subscription_link_unavailable')),
            },
            sections: [
              {
                title: t(ctx, 'renewal_selection_service_label'),
                fields: [
                  {
                    label: t(ctx, 'checkout_service_label'),
                    value: formatTelegramConfigRef(config.configUsername, config.userLabel),
                  },
                ],
              },
            ],
          }),
          new InlineKeyboard(),
          'artifact'
        );
        await ctx.reply(t(ctx, 'navigation_continue_hint'), {
          reply_markup: new InlineKeyboard()
            .text(t(ctx, 'menu_my_configs'), `subs:page:${ctx.session.subscriptionListPage ?? 1}`)
            .row()
            .text(t(ctx, 'menu_back_main'), 'nav:main'),
        });
      } catch (err) {
        const message =
          err instanceof RebeccaOriginDownError
            ? t(ctx, 'config_action_panel_down')
            : t(ctx, 'config_action_failed');
        await renderSubscriptionScreen(
          ctx,
          buildUserEmptyState('⚠️', t(ctx, 'subscription_revoke_title'), message),
          backKeyboard(ctx)
        );
      }
    }
  );

  bot.callbackQuery(new RegExp(`^config:delete_prompt:${CONFIG_ID_CAPTURE}$`, 'u'), async (ctx) => {
    const config = await ownedConfig(ctx, ctx.match[1]!);
    if (!config) return;
    await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
    const quote = await ctx.services!.refundService.quote(config.telegramId, config.id);
    const keyboard = new InlineKeyboard();
    if (quote.eligible) {
      keyboard
        .text(
          t(ctx, 'config_delete_refund_confirm_button', {
            amount: localizedNumber(quote.refundAmount, ctx),
          }),
          callbackData('config', 'refund_confirm', config.id)
        )
        .row();
    }
    keyboard
      .text(
        t(ctx, 'config_delete_without_refund_button'),
        callbackData('config', 'delete_confirm', config.id)
      )
      .row()
      .text(t(ctx, 'menu_back'), callbackData('config', 'refresh', config.id));

    await renderSubscriptionScreen(ctx, buildDeleteReviewScreen(ctx, config, quote), keyboard);
  });

  bot.callbackQuery(
    new RegExp(`^config:refund_confirm:${CONFIG_ID_CAPTURE}$`, 'u'),
    async (ctx) => {
      const config = await ownedConfig(ctx, ctx.match[1]!);
      if (!config) return;
      if (!acquireUserActionCooldown(ctx.from.id, `config-refund:${config.id}`, 3_000)) {
        await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
        return;
      }
      await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
      try {
        const result = await ctx.services!.refundService.executeDeleteWithRefund(
          config.telegramId,
          config.id
        );
        if (!result.eligible) {
          await renderSubscriptionScreen(
            ctx,
            buildUserScreen({
              emoji: '⚠️',
              title: t(ctx, 'config_delete_review_title'),
              subtitle: t(ctx, 'config_delete_no_refund_subtitle'),
              primary: {
                emoji: '⚠️',
                label: t(ctx, 'config_delete_eligibility_label'),
                value: t(ctx, `refund_reason_${result.reason}`),
              },
            }),
            backKeyboard(ctx, 'main')
          );
          return;
        }
        await renderSubscriptionScreen(
          ctx,
          buildDeleteResultScreen(
            ctx,
            result.configUsername,
            result.refundAmount,
            true,
            config.userLabel
          ),
          backKeyboard(ctx, 'main')
        );
      } catch (err) {
        await renderSubscriptionScreen(
          ctx,
          buildUserEmptyState(
            err instanceof RefundOutcomePendingError ? '⏳' : '⚠️',
            t(ctx, 'config_delete_review_title'),
            t(
              ctx,
              err instanceof RefundOutcomePendingError
                ? 'config_refund_pending'
                : 'config_refund_failed'
            )
          ),
          backKeyboard(ctx, 'main')
        );
      }
    }
  );

  bot.callbackQuery(
    new RegExp(`^config:delete_confirm:${CONFIG_ID_CAPTURE}$`, 'u'),
    async (ctx) => {
      const config = await ownedConfig(ctx, ctx.match[1]!);
      if (!config) return;
      if (!acquireUserActionCooldown(ctx.from.id, `config-delete:${config.id}`, 3_000)) {
        await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
        return;
      }
      await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
      try {
        const deleted = await ctx.services!.configService.deleteConfigCompletely(
          config.configUsername,
          config.panelId
        );
        await renderSubscriptionScreen(
          ctx,
          deleted
            ? buildDeleteResultScreen(
                ctx,
                config.configUsername,
                undefined,
                false,
                config.userLabel
              )
            : buildUserEmptyState(
                '⚠️',
                t(ctx, 'config_delete_review_title'),
                tm(ctx, 'config_delete_not_found', { username: config.configUsername })
              ),
          backKeyboard(ctx, 'main')
        );
      } catch {
        await renderSubscriptionScreen(
          ctx,
          buildUserEmptyState(
            '⚠️',
            t(ctx, 'config_delete_review_title'),
            t(ctx, 'config_action_failed')
          ),
          backKeyboard(ctx, 'main')
        );
      }
    }
  );

  bot.callbackQuery(new RegExp(`^config:transfer:${CONFIG_ID_CAPTURE}$`, 'u'), async (ctx) => {
    const config = await ownedConfig(ctx, ctx.match[1]!);
    if (!config) return;
    ctx.session.transferConfigId = config.id;
    ctx.session.transferConfigOwnerTelegramId = config.telegramId;
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('transferConfigConversation');
  });

  bot.callbackQuery(new RegExp(`^config:label:${CONFIG_ID_CAPTURE}$`, 'u'), async (ctx) => {
    const config = await ownedConfig(ctx, ctx.match[1]!);
    if (!config) return;
    ctx.session.labelConfigId = config.id;
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('editConfigLabelConversation');
  });

  bot.callbackQuery(new RegExp(`^config:qr:${CONFIG_ID_CAPTURE}$`, 'u'), async (ctx) => {
    const config = await ownedConfig(ctx, ctx.match[1]!);
    if (!config) return;
    await ctx.answerCallbackQuery({ text: t(ctx, 'subscription_qr_generating') });
    try {
      const remote = await ctx.services!.configService.getRemoteConfigDetail(config);
      const url = remote.subscription_url || config.subUrl;
      if (!url) throw new Error('SUBSCRIPTION_URL_UNAVAILABLE');
      const image = await QRCode.toBuffer(url, {
        width: 720,
        margin: 2,
        errorCorrectionLevel: 'M',
      });
      const photo = await ctx.replyWithPhoto(new InputFile(image, `${config.configUsername}.png`), {
        caption: buildUserScreen({
          emoji: '📷',
          title: t(ctx, 'subscription_qr_title'),
          subtitle: t(ctx, 'subscription_qr_subtitle'),
          primary: {
            label: t(ctx, 'subscription_qr_service_label'),
            value: formatTelegramConfigRef(config.configUsername, config.userLabel),
            inline: true,
          },
        }),
        parse_mode: 'Markdown',
        reply_markup: dismissKeyboard(ctx),
      });
      rememberArtifactMessage(ctx.session, photo.message_id);
    } catch {
      await renderSubscriptionScreen(
        ctx,
        buildUserEmptyState(
          '⚠️',
          t(ctx, 'subscription_qr_title'),
          t(ctx, 'subscription_qr_failed')
        ),
        new InlineKeyboard().text(t(ctx, 'menu_back'), callbackData('config', 'view', config.id))
      );
    }
  });
}

async function ownedConfig(ctx: MenuContext, configId: string, answerIfMissing = true) {
  if (!ctx.services || !ctx.from) return undefined;
  const isAdmin = Boolean(
    ctx.from && typeof ctx.services?.isAdmin === 'function' && ctx.services.isAdmin(ctx.from.id)
  );
  const config = isAdmin
    ? await ctx.services.configService.getConfigById(configId)
    : await ctx.services.configService.getOwnedConfigById(ctx.from.id, configId);
  if (!config && answerIfMissing) {
    await ctx.answerCallbackQuery({ text: t(ctx, 'config_not_owned'), show_alert: true });
  }
  return config;
}

async function buildSubscriptionCard(
  ctx: MenuContext,
  config: UserConfigRecord,
  isDetailView = false,
  backCallback?: string
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const snapshot = await buildSubscriptionSnapshot(ctx, config, {
    includeProgressBars: isDetailView,
  });
  const isAdmin = Boolean(
    ctx.from && typeof ctx.services?.isAdmin === 'function' && ctx.services.isAdmin(ctx.from.id)
  );
  const inAdminContext = isAdmin && ctx.session?.adminLastContext === 'admin';
  const resolvedBack =
    backCallback ??
    (isAdmin && ctx.from && (config.telegramId !== ctx.from.id || inAdminContext)
      ? `admin:user:subscriptions:${config.telegramId}:1`
      : 'subs:page:1');
  const keyboard = buildSubscriptionActionKeyboard(
    ctx,
    config.id,
    snapshot.status,
    config.autoRenewEnabled,
    isDetailView,
    resolvedBack
  );

  if (!isDetailView) {
    return {
      text: buildUserScreen({
        emoji: '📱',
        title: formatTelegramConfigRef(config.configUsername, config.userLabel),
        primary: {
          emoji: statusEmoji(snapshot.status),
          label: t(ctx, 'subscription_status_label'),
          value: buildStatusBadge(ctx, statusBadgeType(snapshot.status), snapshot.statusLabel),
          inline: true,
        },
        sections: [
          {
            title: t(ctx, 'subscription_usage_section'),
            fields: [
              { label: t(ctx, 'remaining'), value: snapshot.remaining },
              { label: t(ctx, 'expiry'), value: snapshot.expiryInfo },
            ],
          },
        ],
        footer: snapshot.remoteAvailable ? undefined : `⚠️ ${t(ctx, 'subscription_cached_notice')}`,
      }),
      keyboard,
    };
  }

  return {
    text: buildUserScreen({
      emoji: '📱',
      title: tm(ctx, 'subscription_detail_heading', { username: config.configUsername }),
      subtitle: t(
        ctx,
        snapshot.remoteAvailable
          ? 'subscription_detail_live_subtitle'
          : 'subscription_detail_cached_subtitle'
      ),
      primary: {
        emoji: statusEmoji(snapshot.status),
        label: t(ctx, 'subscription_status_label'),
        value: buildStatusBadge(ctx, statusBadgeType(snapshot.status), snapshot.statusLabel),
        inline: true,
      },
      sections: [
        {
          title: t(ctx, 'subscription_usage_section'),
          fields: [
            ...(config.userLabel
              ? [
                  {
                    emoji: '🏷️',
                    label: t(ctx, 'subscription_label_field'),
                    value: escapeTelegramMarkdown(config.userLabel),
                  },
                ]
              : []),
            { label: t(ctx, 'remaining'), value: snapshot.remaining },
            { label: t(ctx, 'expiry'), value: snapshot.expiryInfo },
          ],
        },
        {
          title: t(ctx, 'subscription_connection_section'),
          fields: [
            {
              label: t(ctx, 'subscription_last_connection_label'),
              value: snapshot.onlineInfo,
            },
            {
              label: t(ctx, 'subscription_created_label'),
              value: snapshot.createdInfo,
            },
            {
              label: t(ctx, 'subscription_link_label'),
              value: formatSubscriptionLink(
                snapshot.subUrl,
                t(ctx, 'subscription_link_unavailable')
              ),
            },
          ],
        },
        {
          title: t(ctx, 'subscription_automation_section'),
          fields: [
            {
              label: t(ctx, 'subscription_auto_renew_label'),
              value: config.autoRenewEnabled
                ? `🟢 ${t(ctx, 'ui_status_active')} · ${snapshot.autoRenewPackageName ?? t(ctx, 'auto_renew_package_unavailable')}`
                : `⚪️ ${t(ctx, 'ui_status_inactive')}`,
            },
          ],
        },
      ],
      footer: snapshot.remoteAvailable ? undefined : `⚠️ ${t(ctx, 'subscription_cached_notice')}`,
    }),
    keyboard,
  };
}

async function buildSubscriptionSnapshot(
  ctx: MenuContext,
  config: UserConfigRecord,
  options: { includeProgressBars?: boolean } = {}
): Promise<SubscriptionSnapshot & { remoteAvailable: boolean }> {
  let remote: RebeccaUserDetail | undefined;
  try {
    remote = await ctx.services!.configService.getRemoteConfigDetail(config);
  } catch {
    remote = undefined;
  }

  const traffic = calculateTraffic(remote, config);
  const expire = remote?.expire ?? config.panelExpire;
  const onHoldExpireDuration =
    remote?.on_hold_expire_duration ?? config.panelOnHoldExpireDuration ?? null;
  const status = effectiveStatus(
    remote?.status ?? config.panelStatus ?? 'unknown',
    traffic.remainingBytes ?? undefined,
    expire
  );
  let remaining: string;
  if (traffic.isUnavailable) {
    remaining = t(ctx, 'traffic_unavailable');
  } else if (traffic.isUnlimited) {
    remaining = t(ctx, 'unlimited');
  } else if (traffic.remainingBytes != null) {
    const gb = Number((traffic.remainingBytes / 1024 ** 3).toFixed(2));
    remaining = `${localizedNumber(gb, ctx)} ${t(ctx, 'traffic_unit_gb')}${
      traffic.isCached ? ` · ${t(ctx, 'cached_data_label')}` : ''
    }`;
    if (
      options.includeProgressBars &&
      traffic.dataLimit != null &&
      traffic.dataLimit > 0 &&
      traffic.usedTraffic != null
    ) {
      const bar = renderSleekProgressBar(traffic.usedTraffic, traffic.dataLimit, {
        barLength: 8,
        theme: 'traffic',
        locale: resolveContextLocale(ctx),
      });
      if (bar) {
        remaining = `${remaining}\n${bar}`;
      }
    }
  } else {
    remaining = t(ctx, 'traffic_unavailable');
  }
  let expiryInfo =
    status === 'on_hold'
      ? formatOnHoldExpiry(ctx, onHoldExpireDuration)
      : formatExpiry(ctx, expire);
  if (
    options.includeProgressBars &&
    status !== 'on_hold' &&
    expire != null &&
    expire * 1000 > Date.now()
  ) {
    const createdAtMs = new Date(remote?.created_at || config.createdAt).getTime();
    const expireMs = expire * 1000;
    const totalMs = expireMs - createdAtMs;
    const elapsedMs = Date.now() - createdAtMs;
    if (totalMs > 0 && elapsedMs >= 0) {
      const timeBar = renderSleekProgressBar(elapsedMs, totalMs, {
        barLength: 8,
        theme: 'time',
        locale: resolveContextLocale(ctx),
      });
      if (timeBar) {
        expiryInfo = `${expiryInfo}\n${timeBar}`;
      }
    }
  }
  const onlineInfo = formatOnline(ctx, remote?.online_at ?? undefined);
  const subUrl = remote?.subscription_url || config.subUrl;
  const pkgOption = config.autoRenewPackageId
    ? ctx.services?.pricingService.getPackageById(config.autoRenewPackageId)
    : undefined;
  const autoRenewPackageName = pkgOption
    ? escapeTelegramMarkdown(localizedPackageName(ctx, pkgOption.id, pkgOption.name))
    : undefined;
  return {
    remoteAvailable: remote !== undefined,
    status,
    statusLabel: localizedSubscriptionStatusLabel(ctx, status),
    remaining,
    expiryInfo,
    onlineInfo,
    createdInfo: localizedDate(new Date(remote?.created_at || config.createdAt), ctx),
    subUrl: subUrl ?? undefined,
    autoRenewPackageName,
  };
}

/** Action keyboard for a single subscription detail screen. */
export function buildSubscriptionActionKeyboard(
  ctx: MenuContext,
  configId: string,
  status: string,
  autoRenewEnabled = false,
  isDetailView = false,
  backCallback?: string
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  if (!isDetailView) {
    return keyboard
      .text(
        t(ctx, 'subscription_view_detail', undefined) || '👁 جزئیات',
        callbackData('config', 'view', configId)
      )
      .row();
  }

  // Level 2 Detail View Keyboard:
  // Primary Actions Row 1
  keyboard
    .text(t(ctx, 'renewal_button'), callbackData('renew', 'open', configId))
    .text(t(ctx, 'subscription_qr_button'), callbackData('config', 'qr', configId))
    .row();

  // Primary Actions Row 2
  keyboard
    .text(t(ctx, 'subscription_refresh_button'), callbackData('config', 'refresh', configId))
    .text(
      t(ctx, autoRenewEnabled ? 'auto_renew_disable_button' : 'auto_renew_enable_button'),
      callbackData('autorenew', autoRenewEnabled ? 'off' : 'on', configId)
    )
    .row();

  // Row 3: Service control & link actions
  keyboard
    .text(
      status === 'disabled'
        ? t(ctx, 'subscription_enable_button')
        : t(ctx, 'subscription_disable_button'),
      callbackData('config', 'set', status === 'disabled' ? 'on' : 'off', configId)
    )
    .text(t(ctx, 'subscription_revoke_button'), callbackData('config', 'revoke_prompt', configId))
    .row();

  // Row 4: Ownership, label & danger zone actions
  keyboard
    .text(t(ctx, 'subscription_label_button'), callbackData('config', 'label', configId))
    .row();

  keyboard
    .text(t(ctx, 'subscription_transfer_button'), callbackData('config', 'transfer', configId))
    .text(t(ctx, 'config_delete_button'), callbackData('config', 'delete_prompt', configId))
    .row();

  // Row 5: Navigation back
  keyboard.text(t(ctx, 'menu_back'), backCallback ?? 'subs:page:1');

  return keyboard;
}

function effectiveStatus(
  status: string,
  remainingBytes: number | undefined,
  expire: number | null | undefined
): string {
  if (expire != null && expire * 1000 <= Date.now()) return 'expired';
  if (remainingBytes !== undefined && remainingBytes <= 0) return 'depleted';
  return status;
}

function formatOnHoldExpiry(ctx: MenuContext, durationSec: number | null | undefined): string {
  if (typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec > 0) {
    const days = Math.max(1, Math.round(durationSec / 86_400));
    return t(ctx, 'subscription_expiry_on_hold_days', {
      days: localizedNumber(days, ctx),
    });
  }
  return t(ctx, 'subscription_expiry_on_hold');
}

function formatExpiry(ctx: MenuContext, expire: number | null | undefined): string {
  if (expire == null) return t(ctx, 'subscription_expiry_never');
  const date = new Date(expire * 1000);
  const days = Math.ceil((expire * 1000 - Date.now()) / 86_400_000);
  return days > 0
    ? t(ctx, 'subscription_expiry_remaining', {
        date: localizedDate(date, ctx),
        days: localizedNumber(days, ctx),
      })
    : t(ctx, 'subscription_expiry_expired', { date: localizedDate(date, ctx) });
}

function formatOnline(ctx: MenuContext, onlineAt: string | undefined): string {
  if (!onlineAt) return t(ctx, 'subscription_online_never');
  const date = new Date(onlineAt);
  if (Number.isNaN(date.getTime())) return onlineAt;
  return `${localizedDate(date, ctx)} ${date.toLocaleTimeString(resolveContextLocale(ctx) === 'fa' ? 'fa-IR' : 'en-US', { hour: '2-digit', minute: '2-digit' })}`;
}

function localizedSubscriptionStatusLabel(ctx: MenuContext, status: string): string {
  const key = `subscription_state_${status}`;
  const translated = t(ctx, key);
  return translated === key
    ? t(ctx, 'subscription_state_unknown', { status: escapeTelegramMarkdown(status) })
    : translated;
}

function statusBadgeType(status: string): StatusType {
  if (status === 'active') return 'active';
  if (status === 'disabled') return 'inactive';
  if (status === 'on_hold') return 'pending';
  if (status === 'expired' || status === 'depleted') return 'expired';
  return 'warning';
}

function statusEmoji(status: string): string {
  if (status === 'active') return '🟢';
  if (status === 'disabled') return '⚪️';
  if (status === 'on_hold') return '⏳';
  if (status === 'expired' || status === 'depleted') return '⌛';
  return '⚠️';
}

export function buildRenewalCheckoutScreen(
  ctx: MenuContext,
  input: {
    username: string;
    serviceLabel?: string | null;
    packageName?: string;
    gbAmount: number;
    bonusGb?: number;
    durationDays: number;
    amount: number;
    originalPrice?: number;
    effectivePrice?: number;
    pricePerGb: number;
    walletBalance?: number;
    creditLimit?: number;
    groupLabel?: string | null;
    groupDiscountPercent?: number;
    groupDiscountAmount?: number;
    catalogDiscount?: ResolvedCatalogDiscount;
    promoCode?: string;
    rolloverEnabled?: boolean;
    rollover?: RolloverPreview;
  }
): string {
  const effectivePrice =
    input.effectivePrice ?? input.catalogDiscount?.effectivePrice ?? input.amount;
  const rollover: RolloverPreview | undefined =
    input.rollover ?? (input.rolloverEnabled ? { enabled: true } : { enabled: false });
  return buildUnifiedCheckoutScreen(ctx, {
    mode: 'renewal',
    serviceUsername: input.username,
    serviceLabel: input.serviceLabel ?? null,
    packageName:
      input.packageName ??
      t(ctx, 'custom_package_name', {
        gb: localizedNumber(input.gbAmount, ctx),
        days: localizedNumber(input.durationDays, ctx),
      }),
    gbAmount: input.gbAmount,
    durationDays: input.durationDays,
    originalPrice: input.originalPrice ?? input.catalogDiscount?.originalPrice,
    effectivePrice,
    finalAmount: input.amount,
    pricePerGb: input.pricePerGb,
    walletAvailableBalance: input.walletBalance,
    creditLimit: input.creditLimit,
    groupLabel: input.groupLabel,
    groupDiscountPercent: input.groupDiscountPercent,
    groupDiscountAmount: input.groupDiscountAmount,
    catalogDiscount: input.catalogDiscount,
    rollover,
    ...(input.promoCode
      ? {
          promo: {
            code: input.promoCode,
            discountAmount: Math.max(0, effectivePrice - input.amount),
            bonusGb: input.bonusGb ?? 0,
          },
        }
      : {}),
  });
}

export function buildDeleteReviewScreen(
  ctx: MenuContext,
  config: UserConfigRecord,
  quote: DeleteQuote
): string {
  const refundValue = quote.eligible
    ? `${localizedNumber(quote.refundAmount, ctx)} ${t(ctx, 'currency_toman')}`
    : undefined;
  return buildUserScreen({
    emoji: '🗑️',
    title: t(ctx, 'config_delete_review_title'),
    subtitle: t(
      ctx,
      quote.eligible ? 'config_delete_refund_subtitle' : 'config_delete_no_refund_subtitle'
    ),
    primary: quote.eligible
      ? {
          emoji: '💸',
          label: t(ctx, 'config_delete_refund_label'),
          value: refundValue!,
          emphasizeValue: true,
        }
      : {
          emoji: '⚠️',
          label: t(ctx, 'config_delete_eligibility_label'),
          value: t(ctx, `refund_reason_${quote.reason}`),
        },
    sections: [
      {
        title: t(ctx, 'config_delete_service_label'),
        fields: [
          {
            label: t(ctx, 'checkout_service_label'),
            value: formatTelegramConfigRef(config.configUsername, config.userLabel),
          },
        ],
      },
      ...(quote.eligible
        ? [
            {
              title: t(ctx, 'config_delete_refund_label'),
              fields: [
                {
                  label: t(ctx, 'config_delete_original_charge_label'),
                  value: `${localizedNumber(quote.grossAmount, ctx)} ${t(ctx, 'currency_toman')}`,
                },
                {
                  label: t(ctx, 'config_delete_cashback_label'),
                  value: `${localizedNumber(quote.cashbackWithheld, ctx)} ${t(ctx, 'currency_toman')}`,
                },
                {
                  label: t(ctx, 'config_delete_refund_label'),
                  value: refundValue!,
                },
              ],
            },
          ]
        : []),
    ],
    footer: quote.eligible
      ? `⚠️ ${t(ctx, 'config_delete_refund_consequence')}`
      : `⚠️ ${t(ctx, 'config_delete_no_refund_consequence')}`,
  });
}

function buildDeleteResultScreen(
  ctx: MenuContext,
  username: string,
  refundAmount: number | undefined,
  refunded: boolean,
  userLabel?: string | null
): string {
  const formattedService = formatTelegramConfigRef(username, userLabel);
  return buildUserScreen({
    emoji: '✅',
    title: t(ctx, 'config_delete_success_title'),
    subtitle: t(
      ctx,
      refunded
        ? 'config_delete_success_refund_subtitle'
        : 'config_delete_success_no_refund_subtitle'
    ),
    primary: refunded
      ? {
          emoji: '💸',
          label: t(ctx, 'config_delete_refund_label'),
          value: `${localizedNumber(refundAmount ?? 0, ctx)} ${t(ctx, 'currency_toman')}`,
          emphasizeValue: true,
        }
      : {
          label: t(ctx, 'config_delete_service_label'),
          value: formattedService,
          inline: true,
        },
    ...(refunded
      ? {
          sections: [
            {
              bullet: '',
              fields: [
                {
                  label: t(ctx, 'config_delete_service_label'),
                  value: formattedService,
                },
              ],
            },
          ],
        }
      : {}),
  });
}

async function renderSubscriptionScreen(
  ctx: MenuContext,
  text: string,
  keyboard: InlineKeyboard,
  role: UiMessageRole = 'screen'
): Promise<void> {
  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: keyboard, role });
}
