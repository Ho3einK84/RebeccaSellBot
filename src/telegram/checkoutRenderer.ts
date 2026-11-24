/**
 * Unified Telegram checkout & shortfall screen renderer.
 *
 * Centralizes purchase, custom-volume, and renewal review screens so catalog
 * discounts, promo codes (including `gift_gb`), wallet balance projections,
 * `on_hold` activation notices, and renewal rollover previews stay consistent
 * across every Telegram flow.
 */
import { InlineKeyboard } from 'grammy';
import type { ConversationContext } from './types.js';
import type { ResolvedCatalogDiscount } from '../domain/services/CatalogDiscountService.js';
import type { PurchasePromoType } from '../domain/services/PromoService.js';
import { formatRemainingDiscountDuration } from '../domain/services/PricingService.js';
import { normalizeDataLimit } from '../domain/services/TrafficLimit.js';
import { formatPackageButtonLabel, localizedNumber, resolveContextLocale, t } from './locale.js';
import { buildUserScreen, type UserScreenField, type UserScreenSection } from './designSystem.js';
import { escapeTelegramMarkdown, sanitizeTelegramInlineCode } from './rendering.js';
import { formatTelegramConfigRef } from '../domain/services/TelegramFormatting.js';

export interface RolloverPreview {
  enabled: boolean;
  currentRemainingGb?: number | null;
  currentRemainingDays?: number | null;
  projectedTotalGb?: number | null;
  projectedTotalDays?: number | null;
}

export interface UnifiedCheckoutPromo {
  code: string;
  type?: PurchasePromoType;
  discountAmount?: number;
  bonusGb?: number;
}

export interface UnifiedCheckoutViewModel {
  mode: 'purchase' | 'renewal';
  packageName: string;
  gbAmount: number;
  durationDays: number;
  /** Final amount charged to the wallet after catalog discount & promo. */
  finalAmount: number;
  /** Price before catalog discount (optional; defaults to effectivePrice or finalAmount). */
  originalPrice?: number;
  /** Price after catalog discount, before promo. */
  effectivePrice?: number;
  pricePerGb?: number;
  walletAvailableBalance?: number;
  serviceUsername?: string;
  serviceLabel?: string | null;
  requestedUsername?: string;
  startOnFirstUse?: boolean;
  rollover?: RolloverPreview;
  catalogDiscount?: ResolvedCatalogDiscount;
  promo?: UnifiedCheckoutPromo;
}

export interface InsufficientBalanceViewModel {
  packagePrice: number;
  balance: number;
  includePromoHint?: boolean;
}

const BYTES_PER_GB = 1024 ** 3;

/**
 * Compute a display-only rollover preview from observed service traffic and expiry.
 */
export function computeRolloverPreview(input: {
  enabled: boolean;
  addedGb: number;
  addedDays: number;
  dataLimitBytes?: number | null;
  usedTrafficBytes?: number | null;
  expireTimestampSec?: number | null;
  status?: string | null;
  onHoldExpireDurationSec?: number | null;
  nowMs?: number;
}): RolloverPreview {
  if (!input.enabled) {
    return { enabled: false };
  }

  const normalizedLimit = normalizeDataLimit(input.dataLimitBytes) ?? null;
  let currentRemainingGb: number | null = null;
  let projectedTotalGb: number | null = null;
  if (normalizedLimit !== null && normalizedLimit > 0) {
    const used =
      typeof input.usedTrafficBytes === 'number' && Number.isFinite(input.usedTrafficBytes)
        ? Math.max(0, input.usedTrafficBytes)
        : 0;
    const remBytes = Math.max(0, normalizedLimit - used);
    currentRemainingGb = Number((remBytes / BYTES_PER_GB).toFixed(1));
    projectedTotalGb = Number((currentRemainingGb + input.addedGb).toFixed(1));
  }

  const nowSec = Math.floor((input.nowMs ?? Date.now()) / 1000);
  let currentRemainingDays: number | null = null;
  if (input.status === 'on_hold') {
    const onHoldSec = input.onHoldExpireDurationSec;
    if (typeof onHoldSec === 'number' && Number.isFinite(onHoldSec) && onHoldSec > 0) {
      currentRemainingDays = Math.max(0, Math.ceil(onHoldSec / 86_400));
    }
  } else if (
    typeof input.expireTimestampSec === 'number' &&
    Number.isFinite(input.expireTimestampSec)
  ) {
    const remSec = Math.max(0, input.expireTimestampSec - nowSec);
    currentRemainingDays = remSec > 0 ? Math.ceil(remSec / 86_400) : 0;
  }

  const projectedTotalDays =
    currentRemainingDays !== null ? currentRemainingDays + input.addedDays : null;

  return {
    enabled: true,
    currentRemainingGb,
    currentRemainingDays,
    projectedTotalGb,
    projectedTotalDays,
  };
}

/**
 * Format a compact mobile-safe Telegram button label for a package, avoiding
 * truncation when a catalog discount is active.
 */
export function formatCompactDiscountedPackageLabel(
  ctx: ConversationContext,
  pkg: {
    id: string;
    name: string;
    price: number;
    gbAmount?: number;
    durationDays?: number;
  },
  options: {
    effectivePrice: number;
    tag?: string;
    catalogDiscount?: ResolvedCatalogDiscount;
  }
): string {
  const tag = options.tag ?? '';
  const hasCatalogDiscount = Boolean(
    options.catalogDiscount && options.catalogDiscount.discountAmount > 0
  );

  if (!hasCatalogDiscount || !options.catalogDiscount) {
    return formatPackageButtonLabel(ctx, pkg, {
      effectivePrice: options.effectivePrice,
      tag,
    });
  }

  const discountPct =
    options.catalogDiscount.originalPrice > 0
      ? Math.round(
          (options.catalogDiscount.discountAmount / options.catalogDiscount.originalPrice) * 100
        )
      : 0;
  const discountTag = `${tag}🔥 `;
  const baseLabel = formatPackageButtonLabel(ctx, pkg, {
    effectivePrice: options.effectivePrice,
    tag: discountTag,
  });

  if (discountPct > 0) {
    const locale = resolveContextLocale(ctx);
    const pctText =
      locale === 'fa'
        ? `-${localizedNumber(discountPct, ctx)}٪`
        : `-${localizedNumber(discountPct, ctx)}%`;
    return `${baseLabel} (${pctText})`;
  }
  return baseLabel;
}

/**
 * Build the unified purchase or renewal checkout review screen.
 */
export function buildUnifiedCheckoutScreen(
  ctx: ConversationContext,
  input: UnifiedCheckoutViewModel
): string {
  const renewal = input.mode === 'renewal';
  const currency = t(ctx, 'currency_toman');
  const gbUnit = t(ctx, 'traffic_unit_gb');
  const daysUnit = t(ctx, 'days_unit');
  const locale = resolveContextLocale(ctx);

  const bonusGb = Math.max(0, input.promo?.bonusGb ?? 0);
  const totalGb = input.gbAmount + bonusGb;
  const computedUnitPrice =
    input.pricePerGb ?? (totalGb > 0 ? Math.round(input.finalAmount / totalGb) : input.finalAmount);

  const packageFields: UserScreenField[] = [];
  if (input.serviceUsername) {
    packageFields.push({
      label: t(ctx, 'checkout_service_label'),
      value: formatTelegramConfigRef(input.serviceUsername, input.serviceLabel),
    });
  }
  if (input.requestedUsername) {
    packageFields.push({
      label: t(ctx, 'checkout_custom_name_label'),
      value: `\`${sanitizeTelegramInlineCode(input.requestedUsername)}\``,
    });
  }
  packageFields.push({
    label: t(ctx, renewal ? 'renewal_success_package_label' : 'checkout_package_label'),
    value: escapeTelegramMarkdown(input.packageName),
  });
  packageFields.push({
    label: t(ctx, 'checkout_traffic_label'),
    value: `${localizedNumber(input.gbAmount, ctx)} ${gbUnit}`,
  });
  if (bonusGb > 0) {
    packageFields.push({
      label: t(ctx, 'checkout_total_gb_label'),
      value: `*${localizedNumber(totalGb, ctx)}* ${gbUnit}`,
    });
  }
  packageFields.push({
    label: t(ctx, 'checkout_duration_label'),
    value: `${localizedNumber(input.durationDays, ctx)} ${daysUnit}`,
  });
  packageFields.push({
    label: t(ctx, 'checkout_unit_price_label'),
    value: `${localizedNumber(computedUnitPrice, ctx)} ${currency}`,
  });

  if (!renewal && input.startOnFirstUse) {
    packageFields.push({
      emoji: '⏳',
      label: t(ctx, 'checkout_on_hold_label'),
      value: t(ctx, 'checkout_on_hold_notice'),
    });
  }

  if (renewal && input.rollover?.enabled) {
    const hasNumericGb =
      typeof input.rollover.currentRemainingGb === 'number' &&
      input.rollover.currentRemainingGb > 0 &&
      typeof input.rollover.projectedTotalGb === 'number';
    const hasNumericDays =
      typeof input.rollover.currentRemainingDays === 'number' &&
      input.rollover.currentRemainingDays > 0 &&
      typeof input.rollover.projectedTotalDays === 'number';

    if (hasNumericGb || hasNumericDays) {
      const parts: string[] = [];
      if (hasNumericGb) {
        parts.push(
          t(ctx, 'renewal_rollover_preview_gb', {
            current: localizedNumber(input.rollover.currentRemainingGb!, ctx),
            added: localizedNumber(totalGb, ctx),
            total: localizedNumber(input.rollover.projectedTotalGb! + bonusGb, ctx),
          })
        );
      }
      if (hasNumericDays) {
        parts.push(
          t(ctx, 'renewal_rollover_preview_days', {
            current: localizedNumber(input.rollover.currentRemainingDays!, ctx),
            added: localizedNumber(input.durationDays, ctx),
            total: localizedNumber(input.rollover.projectedTotalDays!, ctx),
          })
        );
      }
      packageFields.push({
        emoji: '♻️',
        label: t(ctx, 'renewal_rollover_label'),
        value: `${t(ctx, 'renewal_rollover_notice')}\n${parts.join(' · ')}`,
      });
    } else {
      packageFields.push({
        emoji: '♻️',
        label: t(ctx, 'renewal_rollover_label'),
        value: t(ctx, 'renewal_rollover_notice'),
      });
    }
  }

  const sections: UserScreenSection[] = [
    {
      title: t(ctx, 'checkout_package_section'),
      fields: packageFields,
    },
  ];

  const catalogDiscount = input.catalogDiscount;
  if (catalogDiscount && catalogDiscount.discountAmount > 0) {
    sections.push({
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
        {
          label: t(ctx, 'checkout_savings_label'),
          value: `${localizedNumber(catalogDiscount.discountAmount, ctx)} ${currency}`,
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
    });
  }

  if (input.promo?.code) {
    const promoDiscountAmount =
      input.promo.discountAmount ??
      Math.max(
        0,
        (input.effectivePrice ?? input.originalPrice ?? input.finalAmount) - input.finalAmount
      );
    const promoFields: UserScreenField[] = [
      {
        label: t(ctx, 'shop_promo_section'),
        value: `\`${sanitizeTelegramInlineCode(input.promo.code)}\``,
      },
    ];
    if (promoDiscountAmount > 0) {
      promoFields.push({
        label: t(ctx, 'checkout_discount_label'),
        value: `${localizedNumber(promoDiscountAmount, ctx)} ${currency}`,
      });
    }
    if (bonusGb > 0) {
      promoFields.push({
        label: t(ctx, 'checkout_bonus_gb_label'),
        value: `+${localizedNumber(bonusGb, ctx)} ${gbUnit}`,
      });
    }
    sections.push({
      emoji: '🎟️',
      title: t(ctx, 'checkout_promo_section'),
      fields: promoFields,
    });
  }

  if (input.walletAvailableBalance !== undefined) {
    sections.push({
      title: t(ctx, 'checkout_wallet_section'),
      fields: [
        {
          label: t(ctx, 'checkout_wallet_balance_label'),
          value: `${localizedNumber(input.walletAvailableBalance, ctx)} ${currency}`,
        },
        {
          label: t(ctx, 'checkout_remaining_balance_label'),
          value: `${localizedNumber(Math.max(0, input.walletAvailableBalance - input.finalAmount), ctx)} ${currency}`,
        },
      ],
    });
  }

  return buildUserScreen({
    emoji: renewal ? '🔄' : '🧾',
    title: t(ctx, renewal ? 'renewal_review_title' : 'purchase_review_title'),
    subtitle: t(ctx, renewal ? 'renewal_review_subtitle' : 'purchase_review_subtitle'),
    primary: {
      label: t(ctx, 'checkout_total_label'),
      value: `${localizedNumber(input.finalAmount, ctx)} ${currency}`,
      emphasizeValue: true,
    },
    sections,
    footer: t(ctx, renewal ? 'checkout_confirmation_hint' : 'purchase_confirmation_hint'),
  });
}

/**
 * Build the unified insufficient-balance screen showing exact shortfall,
 * package total, and current available balance.
 */
export function buildUnifiedInsufficientBalanceScreen(
  ctx: ConversationContext,
  input: InsufficientBalanceViewModel
): string {
  const deficit = Math.max(0, input.packagePrice - input.balance);
  const currency = t(ctx, 'currency_toman');
  const footerParts = [t(ctx, 'insufficient_balance_continue_hint')];
  if (input.includePromoHint) {
    footerParts.push(t(ctx, 'insufficient_balance_promo_hint'));
  }

  return buildUserScreen({
    emoji: '💳',
    title: t(ctx, 'insufficient_balance_title'),
    subtitle: t(ctx, 'insufficient_balance_subtitle'),
    primary: {
      emoji: '🔻',
      label: t(ctx, 'insufficient_balance_deficit_label'),
      value: `${localizedNumber(deficit, ctx)} ${currency}`,
      emphasizeValue: true,
    },
    sections: [
      {
        title: t(ctx, 'insufficient_balance_wallet_section'),
        fields: [
          {
            label: t(ctx, 'insufficient_balance_price_label'),
            value: `${localizedNumber(input.packagePrice, ctx)} ${currency}`,
          },
          {
            label: t(ctx, 'insufficient_balance_balance_label'),
            value: `${localizedNumber(input.balance, ctx)} ${currency}`,
          },
        ],
      },
    ],
    footer: footerParts.join('\n'),
  });
}

/**
 * Build the unified insufficient-balance action keyboard (Top-up, optional Promo, Back).
 */
export function buildInsufficientBalanceKeyboard(
  ctx: ConversationContext,
  options: {
    backLabelKey: string;
    backCallback: string;
    promoCallback?: string;
  }
): InlineKeyboard {
  const kb = new InlineKeyboard().text(t(ctx, 'direct_topup_button'), 'topup:direct').row();
  if (options.promoCallback) {
    kb.text(t(ctx, 'shop_apply_promo_button'), options.promoCallback).row();
  }
  kb.text(t(ctx, options.backLabelKey), options.backCallback);
  return kb;
}
