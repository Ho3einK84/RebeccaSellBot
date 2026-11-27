import { InlineKeyboard } from 'grammy';
import {
  CatalogDiscountService,
  type CatalogDiscountRow,
  type CatalogDiscountScope,
  type CatalogDiscountType,
} from '../../domain/services/CatalogDiscountService.js';
import {
  generatePackageId,
  hasDuplicatePackageName,
  MAX_PACKAGE_COUNT,
  parsePackageOptionsJson,
  type PackageOption,
} from '../../domain/services/PricingService.js';
import {
  customVolumeDailyLimit,
  onHoldDefaultEnabled,
  renewalRolloverEnabled,
  shopShowOutOfStock,
  trialDailyLimit,
} from '../../domain/services/FeatureSettings.js';
import {
  CUSTOM_VOLUME_INVENTORY_ID,
  MAX_INVENTORY_VALUE,
  TRIAL_INVENTORY_ID,
} from '../../domain/services/InventoryService.js';
import { localizedDate, localizedNumber, normalizeInputDigits, t } from '../locale.js';
import { escapeTelegramMarkdown, sanitizeTelegramInlineCode } from '../rendering.js';
import {
  buildAdminEmptyState,
  buildAdminPromptScreen,
  buildAdminScreen,
  buildBreadcrumb,
  buildStatusBadge,
  renderScreen,
  type AdminScreenNotice,
} from '../ui.js';
import type { BotServices, MenuContext } from '../types.js';
import {
  appendAdminFooterNav,
  appendAdminPagination,
  buildAdminConfirmKeyboard,
  markAdminContext,
} from './adminNav.js';
import { registerAdminRoute } from './adminRouter.js';
import {
  adminInputCancelKeyboard,
  registerAdminInputHandler,
  startAdminInput,
} from './adminInput.js';
import {
  getSettingDefinition,
  type SettingKey,
} from '../conversations/adminConversations/settings/catalog.js';
import {
  settingValidationMessage,
  validateAdminSetting,
} from '../conversations/adminConversations/settings/validation.js';
import { truncateButtonLabel } from '../conversations/adminConversations/settings/presentation.js';

const PKG_PAGE_SIZE = 6;
const CAT_PAGE_SIZE = 6;
const DISC_PAGE_SIZE = 6;

interface PackageDraft {
  kind: 'pkg_add';
  name?: string;
  gbAmount?: number;
  durationDays?: number;
}

interface DiscountDraft {
  kind: 'dsc_add';
  title?: string;
  scope?: CatalogDiscountScope;
  targetId?: string | null;
  discountType?: CatalogDiscountType;
  value?: number;
  maxDiscountAmount?: number | null;
}

function getCatalogDiscountService(services: BotServices): CatalogDiscountService {
  return services.catalogDiscountService ?? new CatalogDiscountService();
}

function loadPackages(ctx: MenuContext): PackageOption[] {
  if (!ctx.services) return [];
  const parsed = parsePackageOptionsJson(
    ctx.services.translationService.getSetting('packages_json')
  );
  if (parsed) return parsed.map((pkg) => ({ ...pkg }));
  return ctx.services.pricingService.getPackages().map((pkg) => ({ ...pkg }));
}

async function savePackages(ctx: MenuContext, next: readonly PackageOption[]): Promise<void> {
  if (!ctx.services) return;
  await ctx.services.translationService.updateSetting('packages_json', JSON.stringify(next));
}

function parseNonNegInt(raw: string): number | undefined {
  const norm = normalizeInputDigits(raw.trim());
  if (!/^\d+$/u.test(norm)) return undefined;
  const parsed = Number(norm);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function parsePosInt(raw: string): number | undefined {
  const parsed = parseNonNegInt(raw);
  return parsed !== undefined && parsed >= 1 ? parsed : undefined;
}

function parseDateInput(raw: string, endOfDay: boolean): Date | undefined {
  const norm = normalizeInputDigits(raw.trim());
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(norm);
  if (!match) return undefined;
  const iso = endOfDay
    ? `${match[1]}-${match[2]}-${match[3]}T23:59:59.999Z`
    : `${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

// ── 1. Custom Volume (`adm:cv`) ──────────────────────────────────────────────

export async function renderCustomVolumeScreen(
  ctx: MenuContext,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  const ts = ctx.services.translationService;
  const enabled = ts.getSettingBool('custom_volume_enabled', true);
  const pricePerGb = ts.getSettingNum('price_per_gb', 5000);
  const defaultDays = ts.getSettingNum('custom_default_days', 30);
  const dailyLim = customVolumeDailyLimit(ts);
  const customAvail = await ctx.services.inventoryService
    ?.getCustomVolumeAvailability(ctx.services.pricingService.getCustomVolumeTarget())
    .catch(() => null);

  const text = buildAdminScreen({
    emoji: '📐',
    title: t(ctx, 'admin_sales_custom_volume_title'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_home_title'),
      t(ctx, 'admin_sales_title'),
      t(ctx, 'admin_sales_custom_volume_title')
    ),
    notice,
    primary: {
      emoji: enabled ? '🟢' : '⚪️',
      label: t(ctx, 'admin_setting_custom_volume_enabled'),
      value: buildStatusBadge(ctx, enabled ? 'active' : 'inactive'),
      inline: true,
    },
    sections: [
      {
        fields: [
          {
            label: t(ctx, 'admin_setting_price_per_gb'),
            value: `${localizedNumber(pricePerGb, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          {
            label: t(ctx, 'admin_setting_custom_default_days'),
            value: `${localizedNumber(defaultDays, ctx)} ${t(ctx, 'days_unit')}`,
          },
          {
            label: t(ctx, 'admin_panel_stock_label'),
            value:
              customAvail?.stockRemaining !== null && customAvail?.stockRemaining !== undefined
                ? localizedNumber(customAvail.stockRemaining, ctx)
                : t(ctx, 'unlimited'),
          },
          {
            label: t(ctx, 'admin_panel_daily_limit_label'),
            value:
              dailyLim > 0
                ? `${localizedNumber(customAvail?.todayCreatedCount ?? 0, ctx)} / ${localizedNumber(dailyLim, ctx)}`
                : `${localizedNumber(customAvail?.todayCreatedCount ?? 0, ctx)} / ♾️`,
          },
        ],
      },
    ],
  });

  const kb = new InlineKeyboard()
    .text(
      `${t(ctx, 'admin_setting_custom_volume_enabled')}: ${buildStatusBadge(ctx, enabled ? 'active' : 'inactive')}`,
      'adm:cv:tg'
    )
    .row()
    .text(t(ctx, 'admin_setting_price_per_gb'), 'adm:cv:ed:price_per_gb')
    .text(t(ctx, 'admin_setting_custom_default_days'), 'adm:cv:ed:custom_default_days')
    .row()
    .text(t(ctx, 'admin_panel_edit_stock_button'), 'adm:cv:inv:stk')
    .text(t(ctx, 'admin_panel_edit_daily_limit_button'), 'adm:cv:inv:dly')
    .row();
  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:sales',
    backLabel: t(ctx, 'admin_menu_back_to_sales'),
    showHome: true,
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

// ── 2. Free Trial (`adm:trl`) ────────────────────────────────────────────────

export async function renderTrialScreen(
  ctx: MenuContext,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  const ts = ctx.services.translationService;
  const enabled = ts.getSettingBool('trial_enabled', true);
  const trialGb = ts.getSettingNum('trial_gb', 1);
  const trialDays = ts.getSettingNum('trial_days', 3);
  const requirePhone = ts.getSettingBool('require_phone_for_trial', false);
  const dailyLim = trialDailyLimit(ts);
  const trialAvail = await ctx.services.inventoryService?.getTrialAvailability().catch(() => null);

  const text = buildAdminScreen({
    emoji: '🎁',
    title: t(ctx, 'admin_sales_trial_title'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_home_title'),
      t(ctx, 'admin_sales_title'),
      t(ctx, 'admin_sales_trial_title')
    ),
    notice,
    primary: {
      emoji: enabled ? '🟢' : '⚪️',
      label: t(ctx, 'admin_setting_trial_enabled'),
      value: buildStatusBadge(ctx, enabled ? 'active' : 'inactive'),
      inline: true,
    },
    sections: [
      {
        fields: [
          {
            label: t(ctx, 'admin_setting_trial_gb'),
            value: `${localizedNumber(trialGb, ctx)} ${t(ctx, 'traffic_unit_gb')}`,
          },
          {
            label: t(ctx, 'admin_setting_trial_days'),
            value: `${localizedNumber(trialDays, ctx)} ${t(ctx, 'days_unit')}`,
          },
          {
            label: t(ctx, 'admin_panel_stock_label'),
            value:
              trialAvail?.stockRemaining !== null && trialAvail?.stockRemaining !== undefined
                ? localizedNumber(trialAvail.stockRemaining, ctx)
                : t(ctx, 'unlimited'),
          },
          {
            label: t(ctx, 'admin_panel_daily_limit_label'),
            value:
              dailyLim > 0
                ? `${localizedNumber(trialAvail?.todayCreatedCount ?? 0, ctx)} / ${localizedNumber(dailyLim, ctx)}`
                : `${localizedNumber(trialAvail?.todayCreatedCount ?? 0, ctx)} / ♾️`,
          },
          {
            label: t(ctx, 'admin_setting_require_phone_for_trial'),
            value: buildStatusBadge(ctx, requirePhone ? 'active' : 'inactive'),
          },
        ],
      },
    ],
  });

  const kb = new InlineKeyboard()
    .text(
      `${t(ctx, 'admin_setting_trial_enabled')}: ${buildStatusBadge(ctx, enabled ? 'active' : 'inactive')}`,
      'adm:trl:tg'
    )
    .row()
    .text(t(ctx, 'admin_setting_trial_gb'), 'adm:trl:ed:trial_gb')
    .text(t(ctx, 'admin_setting_trial_days'), 'adm:trl:ed:trial_days')
    .row()
    .text(t(ctx, 'admin_panel_edit_stock_button'), 'adm:trl:inv:stk')
    .text(t(ctx, 'admin_panel_edit_daily_limit_button'), 'adm:trl:inv:dly')
    .row()
    .text(t(ctx, 'admin_cfg_phone_shortcut'), 'adm:cfg:gen')
    .row();
  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:sales',
    backLabel: t(ctx, 'admin_menu_back_to_sales'),
    showHome: true,
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

// ── 3. Growth & Rewards (`adm:grw` & `adm:grw:wheel`) ────────────────────────

export async function renderGrowthScreen(
  ctx: MenuContext,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  const ts = ctx.services.translationService;
  const refBonus = ts.getSettingNum('referral_bonus_toman', 10_000);
  const cashback = ts.getSettingNum('cashback_percent', 5);
  const wheelOn = ts.getSettingBool('lucky_wheel_enabled', true);

  const text = buildAdminScreen({
    emoji: '🎡',
    title: t(ctx, 'admin_growth_title'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_home_title'),
      t(ctx, 'admin_sales_title'),
      t(ctx, 'admin_growth_title')
    ),
    notice,
    sections: [
      {
        emoji: '👥',
        title: t(ctx, 'admin_setting_group_referral'),
        fields: [
          {
            label: t(ctx, 'admin_setting_referral_bonus_toman'),
            value: `${localizedNumber(refBonus, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          {
            label: t(ctx, 'admin_setting_cashback_percent'),
            value: `${localizedNumber(cashback, ctx)}%`,
          },
        ],
      },
      {
        emoji: '🎡',
        title: t(ctx, 'admin_sales_lucky_wheel_title'),
        fields: [
          {
            label: t(ctx, 'admin_setting_lucky_wheel_enabled'),
            value: buildStatusBadge(ctx, wheelOn ? 'active' : 'inactive'),
          },
        ],
      },
    ],
  });

  const kb = new InlineKeyboard()
    .text(t(ctx, 'admin_setting_referral_bonus_toman'), 'adm:grw:ed:referral_bonus_toman')
    .text(t(ctx, 'admin_setting_cashback_percent'), 'adm:grw:ed:cashback_percent')
    .row()
    .text(
      `${t(ctx, 'admin_setting_lucky_wheel_enabled')}: ${buildStatusBadge(ctx, wheelOn ? 'active' : 'inactive')}`,
      'adm:grw:w:tg'
    )
    .row()
    .text(t(ctx, 'admin_growth_wheel_settings_button'), 'adm:grw:wheel')
    .row();
  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:sales',
    backLabel: t(ctx, 'admin_menu_back_to_sales'),
    showHome: true,
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

export async function renderLuckyWheelScreen(
  ctx: MenuContext,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  const ts = ctx.services.translationService;
  const enabled = ts.getSettingBool('lucky_wheel_enabled', true);
  const minAmount = ts.getSettingNum('lucky_wheel_min_amount', 1_000);
  const maxAmount = ts.getSettingNum('lucky_wheel_max_amount', 50_000);
  const baseLuck = ts.getSettingNum('lucky_wheel_base_luck_percent', 50);
  const decayPercent = ts.getSettingNum('lucky_wheel_decay_percent', 10);
  const cooldownHours = ts.getSettingNum('lucky_wheel_cooldown_hours', 24);
  const maxSpins = ts.getSettingNum('lucky_wheel_max_spins', 5);

  const text = buildAdminScreen({
    emoji: '🎡',
    title: t(ctx, 'admin_sales_lucky_wheel_title'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_sales_title'),
      t(ctx, 'admin_growth_title'),
      t(ctx, 'admin_sales_lucky_wheel_title')
    ),
    notice,
    primary: {
      emoji: enabled ? '🟢' : '⚪️',
      label: t(ctx, 'admin_setting_lucky_wheel_enabled'),
      value: buildStatusBadge(ctx, enabled ? 'active' : 'inactive'),
      inline: true,
    },
    sections: [
      {
        fields: [
          {
            label: t(ctx, 'admin_setting_lucky_wheel_min_amount'),
            value: `${localizedNumber(minAmount, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          {
            label: t(ctx, 'admin_setting_lucky_wheel_max_amount'),
            value: `${localizedNumber(maxAmount, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          {
            label: t(ctx, 'admin_setting_lucky_wheel_base_luck_percent'),
            value: `${localizedNumber(baseLuck, ctx)}%`,
          },
          {
            label: t(ctx, 'admin_setting_lucky_wheel_decay_percent'),
            value: `${localizedNumber(decayPercent, ctx)}%`,
          },
          {
            label: t(ctx, 'admin_setting_lucky_wheel_cooldown_hours'),
            value: `${localizedNumber(cooldownHours, ctx)} ${t(ctx, 'hours_unit')}`,
          },
          {
            label: t(ctx, 'admin_setting_lucky_wheel_max_spins'),
            value: localizedNumber(maxSpins, ctx),
          },
        ],
      },
    ],
  });

  const kb = new InlineKeyboard()
    .text(
      `${t(ctx, 'admin_setting_lucky_wheel_enabled')}: ${buildStatusBadge(ctx, enabled ? 'active' : 'inactive')}`,
      'adm:grw:w:tg:wheel'
    )
    .row()
    .text(t(ctx, 'admin_setting_lucky_wheel_min_amount'), 'adm:grw:ed:lucky_wheel_min_amount')
    .text(t(ctx, 'admin_setting_lucky_wheel_max_amount'), 'adm:grw:ed:lucky_wheel_max_amount')
    .row()
    .text(
      t(ctx, 'admin_setting_lucky_wheel_base_luck_percent'),
      'adm:grw:ed:lucky_wheel_base_luck_percent'
    )
    .text(t(ctx, 'admin_setting_lucky_wheel_decay_percent'), 'adm:grw:ed:lucky_wheel_decay_percent')
    .row()
    .text(
      t(ctx, 'admin_setting_lucky_wheel_cooldown_hours'),
      'adm:grw:ed:lucky_wheel_cooldown_hours'
    )
    .text(t(ctx, 'admin_setting_lucky_wheel_max_spins'), 'adm:grw:ed:lucky_wheel_max_spins')
    .row();
  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:grw',
    backLabel: `‹ ${t(ctx, 'admin_growth_title')}`,
    showHome: true,
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

// ── 4. Packages & Categories (`adm:pkg:*`, `adm:cat:*`) ──────────────────────

export async function renderPackagesListScreen(
  ctx: MenuContext,
  requestedPage = 1,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  const packages = loadPackages(ctx);
  const totalPages = Math.max(1, Math.ceil(packages.length / PKG_PAGE_SIZE));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const visible = packages.slice((page - 1) * PKG_PAGE_SIZE, page * PKG_PAGE_SIZE);
  const activeCount = packages.filter((p) => p.enabled !== false).length;
  const inactiveCount = packages.length - activeCount;
  const availMap = await ctx.services.inventoryService
    ?.getPackagesAvailabilityMap(visible)
    .catch(() => null);
  const showOutOfStock = shopShowOutOfStock(ctx.services.translationService);

  const kb = new InlineKeyboard();
  for (const pkg of visible) {
    const avail = availMap?.get(pkg.id);
    const icon = pkg.enabled === false ? '⚪' : avail && !avail.available ? '🔴' : '🟢';
    const stockBadge =
      avail && avail.stockRemaining !== null
        ? ` · 📦${localizedNumber(avail.stockRemaining, ctx)}`
        : '';
    kb.text(
      truncateButtonLabel(
        `${icon} ${pkg.name} · ${localizedNumber(pkg.gbAmount, ctx)} ${t(ctx, 'traffic_unit_gb')}${stockBadge}`
      ),
      `adm:pkg:v:${pkg.id}`
    ).row();
  }

  appendAdminPagination(kb, ctx, {
    page,
    totalPages,
    pageCallback: (p) => `adm:pkg:p:${p}`,
  });

  kb.text(t(ctx, 'admin_pkg_add'), 'adm:pkg:add')
    .text(t(ctx, 'admin_pkg_categories_button'), 'adm:cat:p:1')
    .row()
    .text(
      `${t(ctx, 'admin_pkg_show_out_of_stock_btn')}: ${showOutOfStock ? '🟢' : '⚪'}`,
      'adm:pkg:soos'
    )
    .text(t(ctx, 'admin_cfg_service_button'), 'adm:cfg:svc')
    .row();
  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:sales',
    backLabel: t(ctx, 'admin_menu_back_to_sales'),
    showHome: true,
  });

  const text = buildAdminScreen({
    emoji: '📦',
    title: t(ctx, 'admin_package_manager_title'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_home_title'),
      t(ctx, 'admin_sales_title'),
      t(ctx, 'admin_package_manager_title')
    ),
    notice,
    primary: {
      emoji: '📦',
      label: t(ctx, 'admin_pkg_total_label'),
      value: t(ctx, 'admin_pkg_summary_value', {
        total: localizedNumber(packages.length, ctx),
        active: localizedNumber(activeCount, ctx),
        inactive: localizedNumber(inactiveCount, ctx),
      }),
      inline: true,
    },
    ...(visible.length > 0
      ? {
          sections: [
            {
              fields: visible.map((pkg) => ({
                emoji: pkg.enabled !== false ? '🟢' : '⚪️',
                label: escapeTelegramMarkdown(pkg.name),
                value: `${localizedNumber(pkg.gbAmount, ctx)} ${t(ctx, 'traffic_unit_gb')} · ${localizedNumber(pkg.durationDays, ctx)} ${t(ctx, 'days_unit')} · ${localizedNumber(pkg.price, ctx)} ${t(ctx, 'currency_toman')}`,
              })),
            },
          ],
        }
      : {}),
    footer:
      packages.length === 0
        ? t(ctx, 'admin_pkg_empty_list_hint')
        : totalPages > 1
          ? t(ctx, 'admin_pkg_page_status', {
              page: localizedNumber(page, ctx),
              total: localizedNumber(totalPages, ctx),
            })
          : undefined,
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

export async function renderPackageDetailScreen(
  ctx: MenuContext,
  pkgId: string,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  const packages = loadPackages(ctx);
  const index = packages.findIndex((p) => p.id === pkgId);
  if (index === -1) {
    await renderPackagesListScreen(ctx, 1, {
      tone: 'warning',
      text: t(ctx, 'operation_failed'),
    });
    return;
  }
  const pkg = packages[index]!;
  const isEnabled = pkg.enabled !== false;
  const category = pkg.categoryId
    ? await ctx.services.packageCategoryService?.getCategoryById(pkg.categoryId).catch(() => null)
    : null;
  const panel = pkg.panelId ? ctx.services.panelRegistry.getPanel(pkg.panelId) : undefined;
  const serviceName =
    panel?.services.find((s) => s.serviceId === pkg.serviceId)?.name ??
    (pkg.serviceId !== undefined ? `#${pkg.serviceId}` : undefined);
  const targetLabel = panel
    ? `${panel.name}${serviceName ? ` · ${serviceName}` : ''}`
    : t(ctx, 'admin_pkg_default_target');

  const ts = ctx.services.translationService;
  const globalOnHold = onHoldDefaultEnabled(ts);
  const globalRollover = renewalRolloverEnabled(ts);
  const effectiveOnHold = pkg.startOnFirstUse ?? globalOnHold;
  const effectiveRollover = pkg.rolloverQuota ?? globalRollover;
  const onHoldLabel =
    pkg.startOnFirstUse === undefined
      ? `${t(ctx, 'admin_pkg_override_default')} (${globalOnHold ? t(ctx, 'admin_overview_active') : t(ctx, 'admin_overview_inactive')})`
      : buildStatusBadge(ctx, pkg.startOnFirstUse ? 'active' : 'inactive');
  const rolloverLabel =
    pkg.rolloverQuota === undefined
      ? `${t(ctx, 'admin_pkg_override_default')} (${globalRollover ? t(ctx, 'admin_overview_active') : t(ctx, 'admin_overview_inactive')})`
      : buildStatusBadge(ctx, pkg.rolloverQuota ? 'active' : 'inactive');

  const inv = await ctx.services.inventoryService
    ?.getPackageInventoryRecord(pkg.id)
    .catch(() => null);
  const stockDisplay =
    inv && inv.stockRemaining !== null
      ? localizedNumber(inv.stockRemaining, ctx)
      : t(ctx, 'unlimited');
  const userLimitDisplay =
    inv && inv.maxPurchasesPerUser !== null
      ? localizedNumber(inv.maxPurchasesPerUser, ctx)
      : t(ctx, 'unlimited');
  const soldDisplay = localizedNumber(inv?.soldCount ?? 0, ctx);

  const text = buildAdminScreen({
    emoji: '📦',
    title: escapeTelegramMarkdown(pkg.name),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_sales_title'),
      t(ctx, 'admin_package_manager_title'),
      pkg.name
    ),
    notice,
    primary: {
      emoji: isEnabled ? '🟢' : '⚪️',
      label: t(ctx, 'admin_pkg_status_label'),
      value: buildStatusBadge(ctx, isEnabled ? 'active' : 'inactive'),
      inline: true,
    },
    sections: [
      {
        fields: [
          {
            label: t(ctx, 'admin_pkg_gb_label'),
            value: `${localizedNumber(pkg.gbAmount, ctx)} ${t(ctx, 'traffic_unit_gb')}`,
          },
          {
            label: t(ctx, 'admin_pkg_days_label'),
            value: `${localizedNumber(pkg.durationDays, ctx)} ${t(ctx, 'days_unit')}`,
          },
          {
            label: t(ctx, 'admin_pkg_price_label'),
            value: `${localizedNumber(pkg.price, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          {
            label: t(ctx, 'admin_pkg_stock_label'),
            value: stockDisplay,
          },
          {
            label: t(ctx, 'admin_pkg_user_limit_label'),
            value: userLimitDisplay,
          },
          {
            label: t(ctx, 'admin_pkg_sold_label'),
            value: soldDisplay,
          },
          {
            label: t(ctx, 'admin_pkg_category_label'),
            value: category
              ? escapeTelegramMarkdown(
                  `${category.icon ? `${category.icon} ` : ''}${category.name}`
                )
              : t(ctx, 'admin_pkg_no_category'),
          },
          {
            label: t(ctx, 'admin_pkg_target_label'),
            value: escapeTelegramMarkdown(targetLabel),
          },
          {
            label: t(ctx, 'admin_setting_on_hold_default_enabled'),
            value: onHoldLabel,
          },
          {
            label: t(ctx, 'admin_setting_renewal_rollover_enabled'),
            value: rolloverLabel,
          },
        ],
      },
    ],
  });

  const kb = new InlineKeyboard()
    .text(
      isEnabled ? t(ctx, 'admin_pkg_disable_btn') : t(ctx, 'admin_pkg_enable_btn'),
      `adm:pkg:tg:${pkg.id}`
    )
    .text(t(ctx, 'admin_pkg_clone_btn'), `adm:pkg:cl:${pkg.id}`)
    .row()
    .text(t(ctx, 'admin_pkg_edit_name_btn'), `adm:pkg:ed:name:${pkg.id}`)
    .text(t(ctx, 'admin_pkg_edit_gb_btn'), `adm:pkg:ed:gb:${pkg.id}`)
    .row()
    .text(t(ctx, 'admin_pkg_edit_days_btn'), `adm:pkg:ed:days:${pkg.id}`)
    .text(t(ctx, 'admin_pkg_edit_price_btn'), `adm:pkg:ed:price:${pkg.id}`)
    .row()
    .text(t(ctx, 'admin_pkg_edit_stock_btn'), `adm:pkg:ed:stk:${pkg.id}`)
    .text(t(ctx, 'admin_pkg_edit_user_limit_btn'), `adm:pkg:ed:lim:${pkg.id}`)
    .row()
    .text(t(ctx, 'admin_pkg_edit_category_btn'), `adm:pkg:cat:${pkg.id}:1`)
    .text(t(ctx, 'admin_pkg_edit_target_btn'), `adm:pkg:tgt:${pkg.id}`)
    .row()
    .text(
      `${t(ctx, 'admin_pkg_on_hold_btn')}: ${effectiveOnHold ? '🟢' : '⚪'}`,
      `adm:pkg:oh:${pkg.id}`
    )
    .text(
      `${t(ctx, 'admin_pkg_rollover_btn')}: ${effectiveRollover ? '🟢' : '⚪'}`,
      `adm:pkg:ro:${pkg.id}`
    )
    .row();

  if (index > 0) {
    kb.text(t(ctx, 'admin_pkg_move_up_btn'), `adm:pkg:mv:up:${pkg.id}`);
  }
  if (index < packages.length - 1) {
    kb.text(t(ctx, 'admin_pkg_move_down_btn'), `adm:pkg:mv:dn:${pkg.id}`);
  }
  if (index > 0 || index < packages.length - 1) kb.row();

  kb.text(t(ctx, 'admin_pkg_delete_btn'), `adm:pkg:del:${pkg.id}`).row();

  const page = Math.floor(index / PKG_PAGE_SIZE) + 1;
  appendAdminFooterNav(kb, ctx, {
    backCallback: `adm:pkg:p:${page}`,
    backLabel: t(ctx, 'admin_pkg_detail_back_btn'),
    showHome: true,
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

export async function renderCategoriesListScreen(
  ctx: MenuContext,
  requestedPage = 1,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  const categories = (await ctx.services.packageCategoryService?.listCategories(true)) ?? [];
  const packages = loadPackages(ctx);
  const totalPages = Math.max(1, Math.ceil(categories.length / CAT_PAGE_SIZE));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const visible = categories.slice((page - 1) * CAT_PAGE_SIZE, page * CAT_PAGE_SIZE);

  const kb = new InlineKeyboard();
  for (const cat of visible) {
    const linked = packages.filter((p) => p.categoryId === cat.id).length;
    const status = cat.enabled ? '🟢' : '⚪';
    kb.text(
      truncateButtonLabel(
        `${status} ${cat.icon ? `${cat.icon} ` : ''}${cat.name} (${localizedNumber(linked, ctx)})`
      ),
      `adm:cat:v:${cat.id}`
    ).row();
  }

  appendAdminPagination(kb, ctx, {
    page,
    totalPages,
    pageCallback: (p) => `adm:cat:p:${p}`,
  });

  kb.text(t(ctx, 'admin_category_add_button'), 'adm:cat:add').row();
  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:pkg:p:1',
    backLabel: t(ctx, 'admin_menu_back_to_packages'),
    showHome: true,
  });

  const text = buildAdminScreen({
    emoji: '📂',
    title: t(ctx, 'admin_category_manager_title'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_sales_title'),
      t(ctx, 'admin_package_manager_title'),
      t(ctx, 'admin_category_manager_title')
    ),
    notice,
    primary: {
      emoji: '📂',
      label: t(ctx, 'admin_pkg_categories_button'),
      value: localizedNumber(categories.length, ctx),
      inline: true,
    },
    ...(visible.length > 0
      ? {
          sections: [
            {
              fields: visible.map((cat) => {
                const linked = packages.filter((p) => p.categoryId === cat.id).length;
                return {
                  emoji: cat.enabled ? '🟢' : '⚪️',
                  label: escapeTelegramMarkdown(`${cat.icon ? `${cat.icon} ` : ''}${cat.name}`),
                  value: t(ctx, 'admin_category_count_badge', {
                    count: localizedNumber(linked, ctx),
                  }),
                };
              }),
            },
          ],
        }
      : {}),
    footer: categories.length === 0 ? t(ctx, 'admin_category_empty_hint') : undefined,
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

export async function renderCategoryDetailScreen(
  ctx: MenuContext,
  catId: string,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  const categories = (await ctx.services.packageCategoryService?.listCategories(true)) ?? [];
  const index = categories.findIndex((c) => c.id === catId);
  if (index === -1) {
    await renderCategoriesListScreen(ctx, 1);
    return;
  }
  const cat = categories[index]!;
  const linked = loadPackages(ctx).filter((p) => p.categoryId === catId).length;

  const text = buildAdminScreen({
    emoji: cat.icon || '📂',
    title: escapeTelegramMarkdown(cat.name),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_package_manager_title'),
      t(ctx, 'admin_category_manager_title'),
      cat.name
    ),
    notice,
    primary: {
      emoji: cat.enabled ? '🟢' : '⚪️',
      label: t(ctx, 'admin_pkg_status_label'),
      value: buildStatusBadge(ctx, cat.enabled ? 'active' : 'inactive'),
      inline: true,
    },
    sections: [
      {
        fields: [
          {
            label: t(ctx, 'admin_category_icon_label'),
            value: cat.icon ? escapeTelegramMarkdown(cat.icon) : '—',
          },
          {
            label: t(ctx, 'admin_category_desc_label'),
            value: cat.description ? escapeTelegramMarkdown(cat.description) : '—',
          },
          {
            label: t(ctx, 'admin_category_packages_count_label'),
            value: t(ctx, 'admin_category_count_badge', { count: localizedNumber(linked, ctx) }),
          },
        ],
      },
    ],
  });

  const kb = new InlineKeyboard()
    .text(t(ctx, 'admin_category_edit_name_btn'), `adm:cat:ed:name:${cat.id}`)
    .text(t(ctx, 'admin_category_edit_icon_btn'), `adm:cat:ed:icon:${cat.id}`)
    .row()
    .text(t(ctx, 'admin_category_edit_desc_btn'), `adm:cat:ed:desc:${cat.id}`)
    .text(
      cat.enabled ? t(ctx, 'admin_pkg_disable_btn') : t(ctx, 'admin_pkg_enable_btn'),
      `adm:cat:tg:${cat.id}`
    )
    .row();
  if (index > 0) kb.text(t(ctx, 'admin_pkg_move_up_btn'), `adm:cat:mv:up:${cat.id}`);
  if (index < categories.length - 1) {
    kb.text(t(ctx, 'admin_pkg_move_down_btn'), `adm:cat:mv:dn:${cat.id}`);
  }
  if (index > 0 || index < categories.length - 1) kb.row();
  kb.text(t(ctx, 'admin_category_delete_btn'), `adm:cat:del:${cat.id}`).row();

  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:cat:p:1',
    backLabel: t(ctx, 'admin_menu_back_to_categories'),
    showHome: true,
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

// ── 5. Flash / Catalog Discounts (`adm:dsc:*`) ───────────────────────────────

function formatDiscountValue(ctx: MenuContext, discount: CatalogDiscountRow): string {
  if (discount.discountType === 'fixed') {
    return `${localizedNumber(discount.value, ctx)} ${t(ctx, 'currency_toman')}`;
  }
  return `${localizedNumber(discount.value, ctx)}%`;
}

function formatDiscountScope(
  ctx: MenuContext,
  discount: CatalogDiscountRow,
  resolvedTargetName?: string
): string {
  if (discount.scope === 'category') {
    const label = t(ctx, 'admin_sales_discount_scope_category');
    const target = resolvedTargetName ?? discount.targetId;
    return target ? `${label} (${escapeTelegramMarkdown(target)})` : label;
  }
  if (discount.scope === 'package') {
    const label = t(ctx, 'admin_sales_discount_scope_package');
    const pkgName =
      resolvedTargetName ??
      (discount.targetId
        ? loadPackages(ctx).find((p) => p.id === discount.targetId)?.name
        : undefined) ??
      discount.targetId;
    return pkgName ? `${label} (${escapeTelegramMarkdown(pkgName)})` : label;
  }
  return t(ctx, 'admin_sales_discount_scope_all');
}

export async function renderDiscountsListScreen(
  ctx: MenuContext,
  requestedPage = 1,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  const service = getCatalogDiscountService(ctx.services);
  const discounts = await service.listDiscounts();
  const totalPages = Math.max(1, Math.ceil(discounts.length / DISC_PAGE_SIZE));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const visible = discounts.slice((page - 1) * DISC_PAGE_SIZE, page * DISC_PAGE_SIZE);

  const kb = new InlineKeyboard();
  for (const d of visible) {
    const dot = d.active ? '🟢' : '⚪';
    kb.text(
      truncateButtonLabel(`${dot} ${d.title} · ${formatDiscountValue(ctx, d)}`),
      `adm:dsc:v:${d.id}`
    ).row();
  }

  appendAdminPagination(kb, ctx, {
    page,
    totalPages,
    pageCallback: (p) => `adm:dsc:p:${p}`,
  });

  kb.text(t(ctx, 'admin_sales_discount_create_button'), 'adm:dsc:add').row();
  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:sales',
    backLabel: t(ctx, 'admin_menu_back_to_sales'),
    showHome: true,
  });

  const text = buildAdminScreen({
    emoji: '🔥',
    title: t(ctx, 'admin_sales_discounts_title'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_home_title'),
      t(ctx, 'admin_sales_title'),
      t(ctx, 'admin_sales_discounts_title')
    ),
    notice,
    primary: {
      emoji: '🔥',
      label: t(ctx, 'admin_sales_discounts_button'),
      value: localizedNumber(discounts.length, ctx),
      inline: true,
    },
    ...(visible.length > 0
      ? {
          sections: [
            {
              fields: visible.map((d) => ({
                emoji: d.active ? '🟢' : '⚪️',
                label: escapeTelegramMarkdown(d.title),
                value: `${formatDiscountValue(ctx, d)} · ${formatDiscountScope(ctx, d)}`,
              })),
            },
          ],
        }
      : {}),
    footer: discounts.length === 0 ? t(ctx, 'admin_sales_discounts_empty') : undefined,
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

export async function renderDiscountDetailScreen(
  ctx: MenuContext,
  discountId: string,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  const service = getCatalogDiscountService(ctx.services);
  const discount = await service.getDiscountById(discountId);
  if (!discount) {
    await renderDiscountsListScreen(ctx, 1, {
      tone: 'warning',
      text: t(ctx, 'admin_sales_discount_not_found'),
    });
    return;
  }

  let resolvedTargetName: string | undefined;
  if (discount.scope === 'category' && discount.targetId) {
    const cat = await ctx.services.packageCategoryService
      ?.getCategoryById(discount.targetId)
      .catch(() => null);
    if (cat) resolvedTargetName = `${cat.icon ? `${cat.icon} ` : ''}${cat.name}`;
  } else if (discount.scope === 'package' && discount.targetId) {
    resolvedTargetName = loadPackages(ctx).find((p) => p.id === discount.targetId)?.name;
  }

  const text = buildAdminScreen({
    emoji: '🔥',
    title: escapeTelegramMarkdown(discount.title),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_sales_title'),
      t(ctx, 'admin_sales_discounts_title'),
      discount.title
    ),
    notice,
    primary: {
      emoji: discount.active ? '🟢' : '⚪️',
      label: t(ctx, 'admin_sales_discount_value_label'),
      value: `${formatDiscountValue(ctx, discount)} · ${buildStatusBadge(ctx, discount.active ? 'active' : 'inactive')}`,
      inline: true,
    },
    sections: [
      {
        fields: [
          {
            label: t(ctx, 'admin_sales_discount_scope_label'),
            value: formatDiscountScope(ctx, discount, resolvedTargetName),
          },
          {
            label: t(ctx, 'admin_sales_discount_type_label'),
            value:
              discount.discountType === 'fixed'
                ? t(ctx, 'admin_sales_discount_type_fixed')
                : t(ctx, 'admin_sales_discount_type_percent'),
          },
          ...(discount.discountType === 'percent'
            ? [
                {
                  label: t(ctx, 'admin_sales_discount_max_cap_label'),
                  value:
                    discount.maxDiscountAmount && discount.maxDiscountAmount > 0
                      ? `${localizedNumber(discount.maxDiscountAmount, ctx)} ${t(ctx, 'currency_toman')}`
                      : t(ctx, 'admin_promo_no_cap'),
                },
              ]
            : []),
          {
            label: t(ctx, 'admin_sales_discount_starts_label'),
            value: localizedDate(new Date(discount.startsAt), ctx),
          },
          {
            label: t(ctx, 'admin_sales_discount_expires_label'),
            value: discount.expiresAt
              ? localizedDate(new Date(discount.expiresAt), ctx)
              : t(ctx, 'admin_promo_never_expires'),
          },
        ],
      },
    ],
  });

  const kb = new InlineKeyboard()
    .text(
      discount.active
        ? t(ctx, 'admin_sales_discount_deactivate_button')
        : t(ctx, 'admin_sales_discount_activate_button'),
      `adm:dsc:tg:${discount.id}`
    )
    .row()
    .text(t(ctx, 'admin_cdisc_edit_title_btn'), `adm:dsc:ed:title:${discount.id}`)
    .text(t(ctx, 'admin_cdisc_edit_value_btn'), `adm:dsc:ed:val:${discount.id}`)
    .row();

  if (discount.discountType === 'percent') {
    kb.text(t(ctx, 'admin_cdisc_edit_cap_btn'), `adm:dsc:ed:cap:${discount.id}`);
  }
  kb.text(t(ctx, 'admin_cdisc_edit_expiry_btn'), `adm:dsc:ed:exp:${discount.id}`)
    .row()
    .text(t(ctx, 'admin_sales_discount_broadcast_button'), `adm:dsc:bc:${discount.id}`)
    .text(t(ctx, 'admin_sales_discount_delete_button'), `adm:dsc:del:${discount.id}`)
    .row();
  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:dsc:p:1',
    backLabel: `‹ ${t(ctx, 'admin_sales_discounts_title')}`,
    showHome: true,
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

// ── Route & Input Registration ───────────────────────────────────────────────

async function startSimpleSettingEdit(
  ctx: MenuContext,
  key: SettingKey,
  returnRoute: string
): Promise<void> {
  const def = getSettingDefinition(key);
  if (!def || !ctx.services) return;
  const current = ctx.services.translationService.getSetting(key, '—');
  await startAdminInput(ctx, {
    kind: 'sales:setting',
    payload: { key },
    returnRoute,
    promptText: buildAdminPromptScreen({
      emoji: '✏️',
      title: t(ctx, def.labelKey),
      body: t(ctx, 'admin_setting_value_prompt', {
        setting: t(ctx, def.labelKey),
        current_value: `\`${sanitizeTelegramInlineCode(current)}\``,
      }),
    }),
  });
}

export function registerAdminSalesRoutes(): void {
  // Shared single-setting editor for sales modules (Custom Volume, Trial, Referral, Lucky Wheel)
  registerAdminInputHandler('sales:setting', async (ctx, text, state) => {
    if (!ctx.services) return { status: 'done' };
    const key = String(state.payload?.key ?? '') as SettingKey;
    const def = getSettingDefinition(key);
    if (!def) return { status: 'done' };
    const validated = validateAdminSetting(key, text);
    if (validated === undefined) {
      return {
        status: 'retry',
        promptText: buildAdminPromptScreen({
          emoji: '✏️',
          title: t(ctx, def.labelKey),
          body: t(ctx, 'admin_setting_value_prompt', {
            setting: t(ctx, def.labelKey),
            current_value: `\`${sanitizeTelegramInlineCode(ctx.services.translationService.getSetting(key, '—'))}\``,
          }),
          error: settingValidationMessage(ctx, key),
        }),
      };
    }
    await ctx.services.translationService.updateSetting(key, validated);
    return {
      status: 'done',
      notice: { tone: 'success', text: t(ctx, 'admin_setting_saved_title') },
    };
  });

  // ── Custom Volume ──
  registerAdminRoute('adm:cv', async (ctx, _m, notice) => renderCustomVolumeScreen(ctx, notice));
  registerAdminRoute('adm:cv:tg', async (ctx) => {
    if (!ctx.services) return;
    const next = !ctx.services.translationService.getSettingBool('custom_volume_enabled', true);
    await ctx.services.translationService.updateSetting('custom_volume_enabled', String(next));
    await renderCustomVolumeScreen(ctx, {
      tone: 'success',
      text: t(ctx, 'admin_setting_saved_title'),
    });
  });
  registerAdminRoute(/^adm:cv:ed:(price_per_gb|custom_default_days)$/u, async (ctx, match) => {
    await startSimpleSettingEdit(ctx, match![1] as SettingKey, 'adm:cv');
  });
  registerAdminRoute(/^adm:cv:inv:(stk|dly)$/u, async (ctx, match) => {
    if (!ctx.services) return;
    const field = match![1]!;
    const currentDisplay =
      field === 'stk'
        ? await (async () => {
            const rec = await ctx
              .services!.inventoryService?.getPackageInventoryRecord(CUSTOM_VOLUME_INVENTORY_ID)
              .catch(() => null);
            return rec && rec.stockRemaining !== null
              ? localizedNumber(rec.stockRemaining, ctx)
              : t(ctx, 'unlimited');
          })()
        : (() => {
            const lim = customVolumeDailyLimit(ctx.services!.translationService);
            return lim > 0 ? localizedNumber(lim, ctx) : t(ctx, 'unlimited');
          })();
    await startAdminInput(ctx, {
      kind: 'sales:sku_inv',
      payload: { scope: 'cv', field, currentDisplay },
      returnRoute: 'adm:cv',
      promptText: buildAdminPromptScreen({
        emoji: '📦',
        title: t(
          ctx,
          field === 'stk' ? 'admin_panel_edit_stock_button' : 'admin_panel_edit_daily_limit_button'
        ),
        body: t(
          ctx,
          field === 'stk' ? 'admin_panel_stock_prompt' : 'admin_panel_daily_limit_prompt',
          { current: currentDisplay }
        ),
      }),
      keyboard: adminInputCancelKeyboard(ctx, (kb) => {
        kb.text(t(ctx, 'admin_panel_limit_unlimited_button'), `adm:cv:ul:${field}`).row();
      }),
    });
  });
  registerAdminRoute(/^adm:cv:ul:(stk|dly)$/u, async (ctx, match) => {
    if (!ctx.services) return;
    if (ctx.session) delete ctx.session.adminInput;
    const field = match![1]!;
    if (field === 'stk') {
      await ctx.services.inventoryService?.setPackageInventory(CUSTOM_VOLUME_INVENTORY_ID, {
        stockRemaining: null,
      });
    } else {
      await ctx.services.translationService.updateSetting('custom_volume_daily_limit', '0');
    }
    await renderCustomVolumeScreen(ctx, {
      tone: 'success',
      text: t(ctx, 'admin_setting_saved_title'),
    });
  });

  // ── Free Trial ──
  registerAdminRoute('adm:trl', async (ctx, _m, notice) => renderTrialScreen(ctx, notice));
  registerAdminRoute('adm:trl:tg', async (ctx) => {
    if (!ctx.services) return;
    const next = !ctx.services.translationService.getSettingBool('trial_enabled', true);
    await ctx.services.translationService.updateSetting('trial_enabled', String(next));
    await renderTrialScreen(ctx, { tone: 'success', text: t(ctx, 'admin_setting_saved_title') });
  });
  registerAdminRoute(/^adm:trl:ed:(trial_gb|trial_days)$/u, async (ctx, match) => {
    await startSimpleSettingEdit(ctx, match![1] as SettingKey, 'adm:trl');
  });
  registerAdminRoute(/^adm:trl:inv:(stk|dly)$/u, async (ctx, match) => {
    if (!ctx.services) return;
    const field = match![1]!;
    const currentDisplay =
      field === 'stk'
        ? await (async () => {
            const rec = await ctx
              .services!.inventoryService?.getPackageInventoryRecord(TRIAL_INVENTORY_ID)
              .catch(() => null);
            return rec && rec.stockRemaining !== null
              ? localizedNumber(rec.stockRemaining, ctx)
              : t(ctx, 'unlimited');
          })()
        : (() => {
            const lim = trialDailyLimit(ctx.services!.translationService);
            return lim > 0 ? localizedNumber(lim, ctx) : t(ctx, 'unlimited');
          })();
    await startAdminInput(ctx, {
      kind: 'sales:sku_inv',
      payload: { scope: 'trl', field, currentDisplay },
      returnRoute: 'adm:trl',
      promptText: buildAdminPromptScreen({
        emoji: '📦',
        title: t(
          ctx,
          field === 'stk' ? 'admin_panel_edit_stock_button' : 'admin_panel_edit_daily_limit_button'
        ),
        body: t(
          ctx,
          field === 'stk' ? 'admin_panel_stock_prompt' : 'admin_panel_daily_limit_prompt',
          { current: currentDisplay }
        ),
      }),
      keyboard: adminInputCancelKeyboard(ctx, (kb) => {
        kb.text(t(ctx, 'admin_panel_limit_unlimited_button'), `adm:trl:ul:${field}`).row();
      }),
    });
  });
  registerAdminRoute(/^adm:trl:ul:(stk|dly)$/u, async (ctx, match) => {
    if (!ctx.services) return;
    if (ctx.session) delete ctx.session.adminInput;
    const field = match![1]!;
    if (field === 'stk') {
      await ctx.services.inventoryService?.setPackageInventory(TRIAL_INVENTORY_ID, {
        stockRemaining: null,
      });
    } else {
      await ctx.services.translationService.updateSetting('trial_daily_limit', '0');
    }
    await renderTrialScreen(ctx, {
      tone: 'success',
      text: t(ctx, 'admin_setting_saved_title'),
    });
  });

  registerAdminInputHandler('sales:sku_inv', async (ctx, rawText, state) => {
    if (!ctx.services) return { status: 'done' };
    const scope = String(state.payload?.scope ?? 'cv');
    const field = String(state.payload?.field ?? 'stk');
    const returnRoute = scope === 'trl' ? 'adm:trl' : 'adm:cv';
    const skuId = scope === 'trl' ? TRIAL_INVENTORY_ID : CUSTOM_VOLUME_INVENTORY_ID;
    const settingKey = scope === 'trl' ? 'trial_daily_limit' : 'custom_volume_daily_limit';
    const trimmed = normalizeInputDigits(rawText.trim()).toLowerCase();
    const isUnlimited = ['-', 'unlimited', 'none', 'نامحدود'].includes(trimmed);
    const parsed = isUnlimited ? null : parseNonNegInt(rawText);
    const maxAllowed = field === 'dly' ? 100_000 : MAX_INVENTORY_VALUE;
    if (!isUnlimited && (parsed === undefined || parsed === null || parsed > maxAllowed)) {
      return {
        status: 'retry',
        promptText: buildAdminPromptScreen({
          emoji: '📦',
          title: t(
            ctx,
            field === 'stk'
              ? 'admin_panel_edit_stock_button'
              : 'admin_panel_edit_daily_limit_button'
          ),
          body: t(
            ctx,
            field === 'stk' ? 'admin_panel_stock_prompt' : 'admin_panel_daily_limit_prompt',
            { current: String(state.payload?.currentDisplay ?? '—') }
          ),
          error: t(ctx, 'admin_setting_invalid'),
        }),
      };
    }
    if (field === 'stk') {
      await ctx.services.inventoryService?.setPackageInventory(skuId, { stockRemaining: parsed });
    } else {
      await ctx.services.translationService.updateSetting(
        settingKey,
        String(parsed === null ? 0 : parsed)
      );
    }
    return {
      status: 'done',
      redirectRoute: returnRoute,
      notice: { tone: 'success', text: t(ctx, 'admin_setting_saved_title') },
    };
  });

  // ── Growth & Rewards (Referral + Cashback + Lucky Wheel) ──
  registerAdminRoute('adm:grw', async (ctx, _m, notice) => renderGrowthScreen(ctx, notice));
  registerAdminRoute('adm:grw:wheel', async (ctx, _m, notice) =>
    renderLuckyWheelScreen(ctx, notice)
  );
  registerAdminRoute('adm:grw:w:tg', async (ctx) => {
    if (!ctx.services) return;
    const next = !ctx.services.translationService.getSettingBool('lucky_wheel_enabled', true);
    await ctx.services.translationService.updateSetting('lucky_wheel_enabled', String(next));
    await renderGrowthScreen(ctx, { tone: 'success', text: t(ctx, 'admin_setting_saved_title') });
  });
  registerAdminRoute('adm:grw:w:tg:wheel', async (ctx) => {
    if (!ctx.services) return;
    const next = !ctx.services.translationService.getSettingBool('lucky_wheel_enabled', true);
    await ctx.services.translationService.updateSetting('lucky_wheel_enabled', String(next));
    await renderLuckyWheelScreen(ctx, {
      tone: 'success',
      text: t(ctx, 'admin_setting_saved_title'),
    });
  });
  registerAdminRoute(
    /^adm:grw:ed:(referral_bonus_toman|cashback_percent|lucky_wheel_min_amount|lucky_wheel_max_amount|lucky_wheel_base_luck_percent|lucky_wheel_decay_percent|lucky_wheel_cooldown_hours|lucky_wheel_max_spins)$/u,
    async (ctx, match) => {
      const key = match![1] as SettingKey;
      const returnRoute = key.startsWith('lucky_wheel_') ? 'adm:grw:wheel' : 'adm:grw';
      await startSimpleSettingEdit(ctx, key, returnRoute);
    }
  );

  // ── Packages ──
  registerAdminRoute('adm:pkg:soos', async (ctx) => {
    if (!ctx.services) return;
    const next = !shopShowOutOfStock(ctx.services.translationService);
    await ctx.services.translationService.updateSetting('shop_show_out_of_stock', String(next));
    await renderPackagesListScreen(ctx, 1, {
      tone: 'success',
      text: t(ctx, 'admin_setting_saved_title'),
    });
  });

  registerAdminRoute(/^adm:pkg:p:(\d+)$/u, async (ctx, match, notice) => {
    await renderPackagesListScreen(ctx, Number(match?.[1]) || 1, notice);
  });

  registerAdminRoute(/^adm:pkg:v:([a-z0-9_-]{1,64})$/u, async (ctx, match, notice) => {
    await renderPackageDetailScreen(ctx, match![1]!, notice);
  });

  registerAdminRoute(/^adm:pkg:tg:([a-z0-9_-]{1,64})$/u, async (ctx, match) => {
    const id = match![1]!;
    const pkgs = loadPackages(ctx);
    const next = pkgs.map((p) => (p.id === id ? { ...p, enabled: p.enabled === false } : p));
    await savePackages(ctx, next);
    await renderPackageDetailScreen(ctx, id, {
      tone: 'success',
      text: t(ctx, 'admin_setting_saved_title'),
    });
  });

  registerAdminRoute(/^adm:pkg:oh:([a-z0-9_-]{1,64})$/u, async (ctx, match) => {
    const id = match![1]!;
    const pkgs = loadPackages(ctx);
    const next = pkgs.map((p) => {
      if (p.id !== id) return p;
      const nextVal =
        p.startOnFirstUse === undefined ? true : p.startOnFirstUse ? false : undefined;
      return { ...p, startOnFirstUse: nextVal };
    });
    await savePackages(ctx, next);
    await renderPackageDetailScreen(ctx, id, {
      tone: 'success',
      text: t(ctx, 'admin_setting_saved_title'),
    });
  });

  registerAdminRoute(/^adm:pkg:ro:([a-z0-9_-]{1,64})$/u, async (ctx, match) => {
    const id = match![1]!;
    const pkgs = loadPackages(ctx);
    const next = pkgs.map((p) => {
      if (p.id !== id) return p;
      const nextVal = p.rolloverQuota === undefined ? true : p.rolloverQuota ? false : undefined;
      return { ...p, rolloverQuota: nextVal };
    });
    await savePackages(ctx, next);
    await renderPackageDetailScreen(ctx, id, {
      tone: 'success',
      text: t(ctx, 'admin_setting_saved_title'),
    });
  });

  registerAdminRoute(/^adm:pkg:mv:(up|dn):([a-z0-9_-]{1,64})$/u, async (ctx, match) => {
    const dir = match![1] === 'up' ? -1 : 1;
    const id = match![2]!;
    const pkgs = loadPackages(ctx);
    const idx = pkgs.findIndex((p) => p.id === id);
    const target = idx + dir;
    if (idx >= 0 && target >= 0 && target < pkgs.length) {
      const [moved] = pkgs.splice(idx, 1);
      pkgs.splice(target, 0, moved!);
      await savePackages(ctx, pkgs);
    }
    await renderPackageDetailScreen(ctx, id);
  });

  registerAdminRoute(/^adm:pkg:cl:([a-z0-9_-]{1,64})$/u, async (ctx, match) => {
    const id = match![1]!;
    const pkgs = loadPackages(ctx);
    if (pkgs.length >= MAX_PACKAGE_COUNT) {
      await renderPackageDetailScreen(ctx, id, {
        tone: 'warning',
        text: t(ctx, 'admin_pkg_limit_reached', {
          count: localizedNumber(MAX_PACKAGE_COUNT, ctx),
        }),
      });
      return;
    }
    const sourceIdx = pkgs.findIndex((p) => p.id === id);
    const source = sourceIdx >= 0 ? pkgs[sourceIdx] : undefined;
    if (!source) {
      await renderPackagesListScreen(ctx, 1);
      return;
    }
    const suffix = t(ctx, 'admin_pkg_copy_suffix');
    let cloneName = `${source.name} ${suffix}`.trim();
    let copyCount = 2;
    while (hasDuplicatePackageName(pkgs, cloneName)) {
      cloneName = `${source.name} ${suffix} ${copyCount++}`.trim();
    }
    const clone: PackageOption = {
      ...source,
      id: generatePackageId(cloneName, pkgs),
      name: cloneName,
    };
    const next = [...pkgs.slice(0, sourceIdx + 1), clone, ...pkgs.slice(sourceIdx + 1)];
    await savePackages(ctx, next);
    const sourceInv = await ctx.services?.inventoryService
      ?.getPackageInventoryRecord(source.id)
      .catch(() => null);
    if (
      sourceInv &&
      (sourceInv.stockRemaining !== null || sourceInv.maxPurchasesPerUser !== null)
    ) {
      await ctx.services?.inventoryService
        ?.setPackageInventory(clone.id, {
          stockRemaining: sourceInv.stockRemaining,
          maxPurchasesPerUser: sourceInv.maxPurchasesPerUser,
        })
        .catch(() => undefined);
    }
    await renderPackageDetailScreen(ctx, clone.id, {
      tone: 'success',
      text: t(ctx, 'admin_setting_saved_title'),
    });
  });

  registerAdminRoute(/^adm:pkg:del:([a-z0-9_-]{1,64})$/u, async (ctx, match) => {
    const id = match![1]!;
    const pkg = loadPackages(ctx).find((p) => p.id === id);
    if (!pkg) {
      await renderPackagesListScreen(ctx, 1);
      return;
    }
    const text = buildAdminScreen({
      emoji: '🗑️',
      title: t(ctx, 'admin_pkg_delete_title'),
      primary: {
        emoji: '📦',
        label: t(ctx, 'admin_pkg_name_label'),
        value: escapeTelegramMarkdown(pkg.name),
        inline: true,
      },
      footer: t(ctx, 'admin_pkg_delete_confirm', { name: escapeTelegramMarkdown(pkg.name) }),
    });
    await renderScreen(ctx, text, {
      parse_mode: 'Markdown',
      reply_markup: buildAdminConfirmKeyboard(ctx, {
        confirmCallback: `adm:pkg:del_ok:${id}`,
        cancelCallback: `adm:pkg:v:${id}`,
        confirmLabel: t(ctx, 'admin_pkg_delete_btn'),
      }),
    });
  });

  registerAdminRoute(/^adm:pkg:del_ok:([a-z0-9_-]{1,64})$/u, async (ctx, match) => {
    const id = match![1]!;
    const next = loadPackages(ctx).filter((p) => p.id !== id);
    await savePackages(ctx, next);
    await ctx.services?.inventoryService?.deletePackageInventory(id).catch(() => undefined);
    await renderPackagesListScreen(ctx, 1, {
      tone: 'success',
      text: t(ctx, 'admin_setting_saved_title'),
    });
  });

  registerAdminRoute(/^adm:pkg:ul:(stk|lim):([a-z0-9_-]{1,64})$/u, async (ctx, match) => {
    if (!ctx.services) return;
    if (ctx.session) delete ctx.session.adminInput;
    const field = match![1]!;
    const id = match![2]!;
    await ctx.services.inventoryService?.setPackageInventory(
      id,
      field === 'stk' ? { stockRemaining: null } : { maxPurchasesPerUser: null }
    );
    await renderPackageDetailScreen(ctx, id, {
      tone: 'success',
      text: t(ctx, 'admin_setting_saved_title'),
    });
  });

  // Package single-field edits via non-blocking adminInput
  const formatPkgFieldPrompt = (
    ctx: MenuContext,
    pkg: PackageOption,
    field: string,
    currentOverride?: string
  ): string => {
    const promptKeyMap: Record<string, string> = {
      name: 'admin_pkg_name_prompt',
      gb: 'admin_pkg_gb_prompt',
      days: 'admin_pkg_days_prompt',
      price: 'admin_pkg_price_prompt',
      stk: 'admin_pkg_stock_prompt',
      lim: 'admin_pkg_user_limit_prompt',
    };
    const currentVal =
      currentOverride ??
      (field === 'name'
        ? sanitizeTelegramInlineCode(pkg.name)
        : field === 'gb'
          ? localizedNumber(pkg.gbAmount, ctx)
          : field === 'days'
            ? localizedNumber(pkg.durationDays, ctx)
            : localizedNumber(pkg.price, ctx));
    return t(ctx, promptKeyMap[field]!, { current: currentVal });
  };

  registerAdminRoute(
    /^adm:pkg:ed:(name|gb|days|price|stk|lim):([a-z0-9_-]{1,64})$/u,
    async (ctx, match) => {
      const field = match![1]!;
      const id = match![2]!;
      const pkg = loadPackages(ctx).find((p) => p.id === id);
      if (!pkg) {
        await renderPackagesListScreen(ctx, 1);
        return;
      }
      let currentDisplay: string | undefined;
      if (field === 'stk' || field === 'lim') {
        const inv = await ctx.services?.inventoryService
          ?.getPackageInventoryRecord(id)
          .catch(() => null);
        const val =
          field === 'stk' ? (inv?.stockRemaining ?? null) : (inv?.maxPurchasesPerUser ?? null);
        currentDisplay = val === null ? t(ctx, 'unlimited') : localizedNumber(val, ctx);
      }
      await startAdminInput(ctx, {
        kind: 'pkg:edit_field',
        payload: { id, field, ...(currentDisplay !== undefined ? { currentDisplay } : {}) },
        returnRoute: `adm:pkg:v:${id}`,
        promptText: buildAdminPromptScreen({
          emoji: '✏️',
          title: escapeTelegramMarkdown(pkg.name),
          body: formatPkgFieldPrompt(ctx, pkg, field, currentDisplay),
        }),
        ...(field === 'stk' || field === 'lim'
          ? {
              keyboard: adminInputCancelKeyboard(ctx, (kb) => {
                kb.text(
                  t(ctx, 'admin_panel_limit_unlimited_button'),
                  `adm:pkg:ul:${field}:${id}`
                ).row();
              }),
            }
          : {}),
      });
    }
  );

  registerAdminInputHandler('pkg:edit_field', async (ctx, text, state) => {
    const id = String(state.payload?.id ?? '');
    const field = String(state.payload?.field ?? '');
    const currentDisplay =
      typeof state.payload?.currentDisplay === 'string' ? state.payload.currentDisplay : undefined;
    const pkgs = loadPackages(ctx);
    const pkg = pkgs.find((p) => p.id === id);
    if (!pkg) return { status: 'done', redirectRoute: 'adm:pkg:p:1' };

    const retry = (errText: string) => ({
      status: 'retry' as const,
      promptText: buildAdminPromptScreen({
        emoji: '✏️',
        title: escapeTelegramMarkdown(pkg.name),
        body: formatPkgFieldPrompt(ctx, pkg, field, currentDisplay),
        error: errText,
      }),
    });

    if (field === 'name') {
      const trimmed = text.trim();
      if (trimmed.length < 1 || trimmed.length > 120) {
        return retry(t(ctx, 'admin_setting_invalid'));
      }
      const excludeIndex = pkgs.findIndex((p) => p.id === id);
      if (hasDuplicatePackageName(pkgs, trimmed, excludeIndex)) {
        return retry(t(ctx, 'admin_pkg_duplicate_name'));
      }
      await savePackages(
        ctx,
        pkgs.map((p) => (p.id === id ? { ...p, name: trimmed } : p))
      );
    } else if (field === 'gb') {
      const val = parsePosInt(text);
      if (val === undefined || val > 100_000) return retry(t(ctx, 'admin_setting_invalid'));
      await savePackages(
        ctx,
        pkgs.map((p) => (p.id === id ? { ...p, gbAmount: val } : p))
      );
    } else if (field === 'days') {
      const val = parsePosInt(text);
      if (val === undefined || val > 3_650) return retry(t(ctx, 'admin_setting_invalid'));
      await savePackages(
        ctx,
        pkgs.map((p) => (p.id === id ? { ...p, durationDays: val } : p))
      );
    } else if (field === 'price') {
      const val = parseNonNegInt(text);
      if (val === undefined) return retry(t(ctx, 'admin_setting_invalid'));
      await savePackages(
        ctx,
        pkgs.map((p) => (p.id === id ? { ...p, price: val } : p))
      );
    } else if (field === 'stk') {
      const norm = normalizeInputDigits(text.trim()).toLowerCase();
      const isUnlimited = ['-', 'unlimited', 'none', 'نامحدود'].includes(norm);
      const val = isUnlimited ? null : parseNonNegInt(text);
      if (!isUnlimited && (val === undefined || val === null || val > MAX_INVENTORY_VALUE)) {
        return retry(t(ctx, 'admin_setting_invalid'));
      }
      await ctx.services?.inventoryService?.setPackageInventory(id, { stockRemaining: val });
    } else if (field === 'lim') {
      const norm = normalizeInputDigits(text.trim()).toLowerCase();
      const isUnlimited = ['-', 'unlimited', 'none', 'نامحدود'].includes(norm);
      const val = isUnlimited ? null : parsePosInt(text);
      if (!isUnlimited && (val === undefined || val === null || val > MAX_INVENTORY_VALUE)) {
        return retry(t(ctx, 'admin_setting_invalid'));
      }
      await ctx.services?.inventoryService?.setPackageInventory(id, { maxPurchasesPerUser: val });
    }
    return {
      status: 'done',
      redirectRoute: `adm:pkg:v:${id}`,
      notice: { tone: 'success', text: t(ctx, 'admin_setting_saved_title') },
    };
  });

  // Package category assignment (paginated; compact index callbacks stay <= 64 bytes)
  registerAdminRoute(/^adm:pkg:cat:([a-z0-9_-]{1,64}):(\d+)$/u, async (ctx, match) => {
    if (!ctx.services) return;
    const pkgId = match![1]!;
    const reqPage = Number(match?.[2]) || 1;
    const pkgs = loadPackages(ctx);
    const pkgIdx = pkgs.findIndex((p) => p.id === pkgId);
    if (pkgIdx < 0) {
      await renderPackagesListScreen(ctx, 1);
      return;
    }
    const cats = (await ctx.services.packageCategoryService?.listCategories(true)) ?? [];
    const totalPages = Math.max(1, Math.ceil(cats.length / CAT_PAGE_SIZE));
    const page = Math.min(Math.max(1, reqPage), totalPages);
    const startIdx = (page - 1) * CAT_PAGE_SIZE;
    const visible = cats.slice(startIdx, startIdx + CAT_PAGE_SIZE);

    const kb = new InlineKeyboard()
      .text(t(ctx, 'admin_pkg_no_category'), `adm:pkg:sc:${pkgIdx}:n`)
      .row();
    visible.forEach((c, offset) => {
      kb.text(
        truncateButtonLabel(`${c.icon ? `${c.icon} ` : ''}${c.name}`),
        `adm:pkg:sc:${pkgIdx}:${startIdx + offset}`
      ).row();
    });
    appendAdminPagination(kb, ctx, {
      page,
      totalPages,
      pageCallback: (p) => `adm:pkg:cat:${pkgId}:${p}`,
    });
    appendAdminFooterNav(kb, ctx, { backCallback: `adm:pkg:v:${pkgId}` });

    await renderScreen(
      ctx,
      buildAdminScreen({
        emoji: '📂',
        title: t(ctx, 'admin_pkg_category_label'),
      }),
      { parse_mode: 'Markdown', reply_markup: kb }
    );
  });

  registerAdminRoute(/^adm:pkg:sc:(\d+):(n|\d+)$/u, async (ctx, match) => {
    if (!ctx.services) return;
    const pkgIdx = Number(match![1]);
    const pkgs = loadPackages(ctx);
    const targetPkg = pkgs[pkgIdx];
    if (!targetPkg) {
      await renderPackagesListScreen(ctx, 1);
      return;
    }
    let catId: string | undefined;
    if (match![2] !== 'n') {
      const cats = (await ctx.services.packageCategoryService?.listCategories(true)) ?? [];
      catId = cats[Number(match![2])]?.id;
    }
    const next = pkgs.map((p) => (p.id === targetPkg.id ? { ...p, categoryId: catId } : p));
    await savePackages(ctx, next);
    await renderPackageDetailScreen(ctx, targetPkg.id, {
      tone: 'success',
      text: t(ctx, 'admin_setting_saved_title'),
    });
  });

  registerAdminRoute(
    /^adm:pkg:setcat:([a-z0-9_-]{1,64}):([a-z0-9_-]{1,64})$/u,
    async (ctx, match) => {
      const pkgId = match![1]!;
      const catId = match![2] === 'none' ? undefined : match![2]!;
      const next = loadPackages(ctx).map((p) => (p.id === pkgId ? { ...p, categoryId: catId } : p));
      await savePackages(ctx, next);
      await renderPackageDetailScreen(ctx, pkgId, {
        tone: 'success',
        text: t(ctx, 'admin_setting_saved_title'),
      });
    }
  );

  // Package target panel/service picker (compact index callbacks stay <= 64 bytes)
  registerAdminRoute(/^adm:pkg:tgt:([a-z0-9_-]{1,64})$/u, async (ctx, match) => {
    if (!ctx.services) return;
    const pkgId = match![1]!;
    const pkgs = loadPackages(ctx);
    const pkgIdx = pkgs.findIndex((p) => p.id === pkgId);
    if (pkgIdx < 0) {
      await renderPackagesListScreen(ctx, 1);
      return;
    }
    const panels = ctx.services.panelRegistry.listPanels();
    const kb = new InlineKeyboard()
      .text(t(ctx, 'admin_pkg_default_target'), `adm:pkg:st:${pkgIdx}:d:0`)
      .row();
    panels.forEach((panel, panelIdx) => {
      for (const svc of panel.services) {
        kb.text(
          truncateButtonLabel(`${panel.enabled ? '🟢' : '⚪'} ${panel.name} · ${svc.name}`),
          `adm:pkg:st:${pkgIdx}:${panelIdx}:${svc.serviceId}`
        ).row();
      }
    });
    appendAdminFooterNav(kb, ctx, { backCallback: `adm:pkg:v:${pkgId}` });
    await renderScreen(
      ctx,
      buildAdminScreen({ emoji: '🖥️', title: t(ctx, 'admin_pkg_target_label') }),
      { parse_mode: 'Markdown', reply_markup: kb }
    );
  });

  registerAdminRoute(/^adm:pkg:st:(\d+):(d|\d+):(\d+)$/u, async (ctx, match) => {
    if (!ctx.services) return;
    const pkgIdx = Number(match![1]);
    const pkgs = loadPackages(ctx);
    const targetPkg = pkgs[pkgIdx];
    if (!targetPkg) {
      await renderPackagesListScreen(ctx, 1);
      return;
    }
    let panelId: string | undefined;
    let serviceId: number | undefined;
    if (match![2] !== 'd') {
      const panels = ctx.services.panelRegistry.listPanels();
      const panel = panels[Number(match![2])];
      if (panel) {
        panelId = panel.id;
        serviceId = Number(match![3]);
      }
    }
    const next = pkgs.map((p) => (p.id === targetPkg.id ? { ...p, panelId, serviceId } : p));
    await savePackages(ctx, next);
    await renderPackageDetailScreen(ctx, targetPkg.id, {
      tone: 'success',
      text: t(ctx, 'admin_setting_saved_title'),
    });
  });

  registerAdminRoute(
    /^adm:pkg:settgt:([a-z0-9_-]{1,64}):([a-z0-9_-]{1,40}):(\d+)$/u,
    async (ctx, match) => {
      const pkgId = match![1]!;
      const panelId = match![2] === 'default' ? undefined : match![2]!;
      const serviceId = panelId ? Number(match![3]) : undefined;
      const next = loadPackages(ctx).map((p) =>
        p.id === pkgId ? { ...p, panelId, serviceId } : p
      );
      await savePackages(ctx, next);
      await renderPackageDetailScreen(ctx, pkgId, {
        tone: 'success',
        text: t(ctx, 'admin_setting_saved_title'),
      });
    }
  );

  // Package creation via non-blocking adminDraft + adminInput (duplicate name checked at step 1!)
  registerAdminRoute('adm:pkg:add', async (ctx) => {
    const pkgs = loadPackages(ctx);
    if (pkgs.length >= MAX_PACKAGE_COUNT) {
      await renderPackagesListScreen(ctx, 1, {
        tone: 'warning',
        text: t(ctx, 'admin_pkg_limit_reached', {
          count: localizedNumber(MAX_PACKAGE_COUNT, ctx),
        }),
      });
      return;
    }
    if (ctx.session) {
      ctx.session.adminDraft = { kind: 'pkg_add' } satisfies PackageDraft;
    }
    await startAdminInput(ctx, {
      kind: 'pkg:add:step',
      payload: { step: 'name' },
      returnRoute: 'adm:pkg:p:1',
      promptText: buildAdminPromptScreen({
        emoji: '➕',
        title: t(ctx, 'admin_pkg_add'),
        body: t(ctx, 'admin_pkg_name_prompt', { current: '—' }),
      }),
    });
  });

  registerAdminInputHandler('pkg:add:step', async (ctx, rawText, state) => {
    const step = String(state.payload?.step ?? 'name');
    const draft = (ctx.session?.adminDraft as PackageDraft | undefined) ?? { kind: 'pkg_add' };
    const pkgs = loadPackages(ctx);

    const retry = (bodyKey: string, errKey: string) => ({
      status: 'retry' as const,
      promptText: buildAdminPromptScreen({
        emoji: '➕',
        title: t(ctx, 'admin_pkg_add'),
        body: t(ctx, bodyKey, { current: '—' }),
        error: t(ctx, errKey),
      }),
    });

    if (step === 'name') {
      const name = rawText.trim();
      if (name.length < 1 || name.length > 120)
        return retry('admin_pkg_name_prompt', 'admin_setting_invalid');
      if (hasDuplicatePackageName(pkgs, name))
        return retry('admin_pkg_name_prompt', 'admin_pkg_duplicate_name');
      draft.name = name;
      if (ctx.session) ctx.session.adminDraft = draft as unknown as Record<string, unknown>;
      await startAdminInput(ctx, {
        kind: 'pkg:add:step',
        payload: { step: 'gb' },
        returnRoute: 'adm:pkg:p:1',
        promptText: buildAdminPromptScreen({
          emoji: '➕',
          title: escapeTelegramMarkdown(name),
          body: t(ctx, 'admin_pkg_gb_prompt', { current: '—' }),
        }),
      });
      return { status: 'handled' };
    }

    if (step === 'gb') {
      const gb = parsePosInt(rawText);
      if (gb === undefined || gb > 100_000)
        return retry('admin_pkg_gb_prompt', 'admin_setting_invalid');
      draft.gbAmount = gb;
      if (ctx.session) ctx.session.adminDraft = draft as unknown as Record<string, unknown>;
      await startAdminInput(ctx, {
        kind: 'pkg:add:step',
        payload: { step: 'days' },
        returnRoute: 'adm:pkg:p:1',
        promptText: buildAdminPromptScreen({
          emoji: '➕',
          title: escapeTelegramMarkdown(draft.name ?? t(ctx, 'admin_pkg_add')),
          body: t(ctx, 'admin_pkg_days_prompt', { current: '—' }),
        }),
      });
      return { status: 'handled' };
    }

    if (step === 'days') {
      const days = parsePosInt(rawText);
      if (days === undefined || days > 3_650)
        return retry('admin_pkg_days_prompt', 'admin_setting_invalid');
      draft.durationDays = days;
      if (ctx.session) ctx.session.adminDraft = draft as unknown as Record<string, unknown>;
      await startAdminInput(ctx, {
        kind: 'pkg:add:step',
        payload: { step: 'price' },
        returnRoute: 'adm:pkg:p:1',
        promptText: buildAdminPromptScreen({
          emoji: '➕',
          title: escapeTelegramMarkdown(draft.name ?? t(ctx, 'admin_pkg_add')),
          body: t(ctx, 'admin_pkg_price_prompt', { current: '—' }),
        }),
      });
      return { status: 'handled' };
    }

    const price = parseNonNegInt(rawText);
    if (price === undefined) return retry('admin_pkg_price_prompt', 'admin_setting_invalid');
    const created: PackageOption = {
      id: generatePackageId(draft.name ?? 'package', pkgs),
      name: draft.name ?? 'Package',
      gbAmount: draft.gbAmount ?? 10,
      durationDays: draft.durationDays ?? 30,
      price,
      enabled: true,
    };
    await savePackages(ctx, [...pkgs, created]);
    if (ctx.session) delete ctx.session.adminDraft;
    return {
      status: 'done',
      redirectRoute: `adm:pkg:v:${created.id}`,
      notice: { tone: 'success', text: t(ctx, 'admin_setting_saved_title') },
    };
  });

  // ── Categories ──
  registerAdminRoute(/^adm:cat:p:(\d+)$/u, async (ctx, match, notice) => {
    await renderCategoriesListScreen(ctx, Number(match?.[1]) || 1, notice);
  });

  registerAdminRoute(/^adm:cat:v:([a-z0-9_-]{1,64})$/u, async (ctx, match, notice) => {
    await renderCategoryDetailScreen(ctx, match![1]!, notice);
  });

  registerAdminRoute(/^adm:cat:tg:([a-z0-9_-]{1,64})$/u, async (ctx, match) => {
    if (!ctx.services) return;
    const id = match![1]!;
    const cat = await ctx.services.packageCategoryService?.getCategoryById(id);
    if (!cat) {
      await renderCategoriesListScreen(ctx, 1);
      return;
    }
    await ctx.services.packageCategoryService?.updateCategory(id, { enabled: !cat.enabled });
    await renderCategoryDetailScreen(ctx, id, {
      tone: 'success',
      text: t(ctx, 'admin_setting_saved_title'),
    });
  });

  registerAdminRoute(/^adm:cat:mv:(up|dn):([a-z0-9_-]{1,64})$/u, async (ctx, match) => {
    if (!ctx.services?.packageCategoryService) return;
    const dir = match![1] === 'up' ? -1 : 1;
    const id = match![2]!;
    const list = await ctx.services.packageCategoryService.listCategories(true);
    const idx = list.findIndex((c) => c.id === id);
    const targetIdx = idx + dir;
    if (idx >= 0 && targetIdx >= 0 && targetIdx < list.length) {
      const a = list[idx]!;
      const b = list[targetIdx]!;
      await ctx.services.packageCategoryService.updateCategory(a.id, { displayOrder: targetIdx });
      await ctx.services.packageCategoryService.updateCategory(b.id, { displayOrder: idx });
    }
    await renderCategoryDetailScreen(ctx, id);
  });

  registerAdminRoute(/^adm:cat:ed:(name|icon|desc):([a-z0-9_-]{1,64})$/u, async (ctx, match) => {
    const field = match![1]!;
    const id = match![2]!;
    const cat = await ctx.services?.packageCategoryService?.getCategoryById(id).catch(() => null);
    const body =
      field === 'name'
        ? t(ctx, 'admin_category_name_prompt')
        : field === 'icon'
          ? t(ctx, 'admin_category_icon_prompt')
          : t(ctx, 'admin_category_desc_prompt', {
              current: sanitizeTelegramInlineCode(cat?.description || '—'),
            });
    await startAdminInput(ctx, {
      kind: 'cat:edit_field',
      payload: { id, field },
      returnRoute: `adm:cat:v:${id}`,
      promptText: buildAdminPromptScreen({
        emoji: '✏️',
        title: cat ? escapeTelegramMarkdown(cat.name) : t(ctx, 'admin_category_manager_title'),
        body,
      }),
    });
  });

  registerAdminInputHandler('cat:edit_field', async (ctx, text, state) => {
    if (!ctx.services?.packageCategoryService) return { status: 'done' };
    const id = String(state.payload?.id ?? '');
    const field = String(state.payload?.field ?? 'name');
    const trimmed = text.trim();
    if (field === 'name') {
      if (trimmed.length < 1 || trimmed.length > 100) {
        return {
          status: 'retry',
          promptText: buildAdminPromptScreen({
            emoji: '✏️',
            title: t(ctx, 'admin_category_manager_title'),
            body: t(ctx, 'admin_category_name_prompt'),
            error: t(ctx, 'admin_setting_invalid'),
          }),
        };
      }
      await ctx.services.packageCategoryService.updateCategory(id, { name: trimmed });
    } else if (field === 'desc') {
      if (trimmed.length > 240) {
        return {
          status: 'retry',
          promptText: buildAdminPromptScreen({
            emoji: '✏️',
            title: t(ctx, 'admin_category_manager_title'),
            body: t(ctx, 'admin_category_desc_prompt', { current: '—' }),
            error: t(ctx, 'admin_setting_invalid'),
          }),
        };
      }
      await ctx.services.packageCategoryService.updateCategory(id, {
        description: trimmed === '-' ? '' : trimmed,
      });
    } else {
      await ctx.services.packageCategoryService.updateCategory(id, {
        icon: trimmed === '-' ? '' : trimmed.slice(0, 16),
      });
    }
    return {
      status: 'done',
      redirectRoute: `adm:cat:v:${id}`,
      notice: { tone: 'success', text: t(ctx, 'admin_setting_saved_title') },
    };
  });

  registerAdminRoute('adm:cat:add', async (ctx) => {
    await startAdminInput(ctx, {
      kind: 'cat:add',
      returnRoute: 'adm:cat:p:1',
      promptText: buildAdminPromptScreen({
        emoji: '➕',
        title: t(ctx, 'admin_category_add_button'),
        body: t(ctx, 'admin_category_name_prompt'),
      }),
    });
  });

  registerAdminInputHandler('cat:add', async (ctx, text) => {
    if (!ctx.services?.packageCategoryService) return { status: 'done' };
    const name = text.trim();
    if (name.length < 1 || name.length > 100) {
      return {
        status: 'retry',
        promptText: buildAdminPromptScreen({
          emoji: '➕',
          title: t(ctx, 'admin_category_add_button'),
          body: t(ctx, 'admin_category_name_prompt'),
          error: t(ctx, 'admin_setting_invalid'),
        }),
      };
    }
    const created = await ctx.services.packageCategoryService.createCategory({ name });
    return {
      status: 'done',
      redirectRoute: `adm:cat:v:${created.id}`,
      notice: { tone: 'success', text: t(ctx, 'admin_setting_saved_title') },
    };
  });

  registerAdminRoute(/^adm:cat:del:([a-z0-9_-]{1,64})$/u, async (ctx, match) => {
    const id = match![1]!;
    const cat = await ctx.services?.packageCategoryService?.getCategoryById(id);
    if (!cat) {
      await renderCategoriesListScreen(ctx, 1);
      return;
    }
    await renderScreen(
      ctx,
      buildAdminScreen({
        emoji: '🗑️',
        title: t(ctx, 'admin_category_delete_btn'),
        primary: {
          emoji: '📂',
          label: t(ctx, 'admin_category_manager_title'),
          value: escapeTelegramMarkdown(cat.name),
          inline: true,
        },
        footer: t(ctx, 'admin_category_delete_confirm', { name: escapeTelegramMarkdown(cat.name) }),
      }),
      {
        parse_mode: 'Markdown',
        reply_markup: buildAdminConfirmKeyboard(ctx, {
          confirmCallback: `adm:cat:del_ok:${id}`,
          cancelCallback: `adm:cat:v:${id}`,
          confirmLabel: t(ctx, 'admin_category_delete_btn'),
        }),
      }
    );
  });

  registerAdminRoute(/^adm:cat:del_ok:([a-z0-9_-]{1,64})$/u, async (ctx, match) => {
    await ctx.services?.packageCategoryService?.deleteCategory(match![1]!);
    await renderCategoriesListScreen(ctx, 1, {
      tone: 'success',
      text: t(ctx, 'admin_setting_saved_title'),
    });
  });

  // ── Catalog / Flash Discounts (`adm:dsc:*`) ──
  registerAdminRoute(/^adm:dsc:p:(\d+)$/u, async (ctx, match, notice) => {
    await renderDiscountsListScreen(ctx, Number(match?.[1]) || 1, notice);
  });

  registerAdminRoute(/^adm:dsc:v:([a-zA-Z0-9_-]{1,64})$/u, async (ctx, match, notice) => {
    await renderDiscountDetailScreen(ctx, match![1]!, notice);
  });

  registerAdminRoute(/^adm:dsc:tg:([a-zA-Z0-9_-]{1,64})$/u, async (ctx, match) => {
    if (!ctx.services) return;
    const id = match![1]!;
    const updated = await getCatalogDiscountService(ctx.services).toggleDiscount(id);
    if (!updated) {
      await renderDiscountsListScreen(ctx, 1, {
        tone: 'warning',
        text: t(ctx, 'admin_sales_discount_not_found'),
      });
      return;
    }
    await renderDiscountDetailScreen(ctx, id, {
      tone: 'success',
      text: t(ctx, 'admin_sales_discount_toggled', {
        name: escapeTelegramMarkdown(updated.title),
        status: updated.active
          ? t(ctx, 'admin_overview_active')
          : t(ctx, 'admin_overview_inactive'),
      }),
    });
  });

  // Delete confirmation (vertical, safe!)
  registerAdminRoute(/^adm:dsc:del:([a-zA-Z0-9_-]{1,64})$/u, async (ctx, match) => {
    if (!ctx.services) return;
    const id = match![1]!;
    const discount = await getCatalogDiscountService(ctx.services).getDiscountById(id);
    if (!discount) {
      await renderDiscountsListScreen(ctx, 1);
      return;
    }
    await renderScreen(
      ctx,
      buildAdminScreen({
        emoji: '🗑️',
        title: t(ctx, 'admin_cdisc_delete_confirm_title'),
        primary: {
          emoji: '🔥',
          label: t(ctx, 'admin_sales_discount_title_label'),
          value: escapeTelegramMarkdown(discount.title),
          inline: true,
        },
        footer: t(ctx, 'admin_cdisc_delete_confirm_body'),
      }),
      {
        parse_mode: 'Markdown',
        reply_markup: buildAdminConfirmKeyboard(ctx, {
          confirmCallback: `adm:dsc:del_ok:${id}`,
          cancelCallback: `adm:dsc:v:${id}`,
          confirmLabel: t(ctx, 'admin_sales_discount_delete_button'),
        }),
      }
    );
  });

  registerAdminRoute(/^adm:dsc:del_ok:([a-zA-Z0-9_-]{1,64})$/u, async (ctx, match) => {
    if (!ctx.services) return;
    const id = match![1]!;
    const service = getCatalogDiscountService(ctx.services);
    const existing = await service.getDiscountById(id);
    const deleted = await service.deleteDiscount(id);
    await renderDiscountsListScreen(ctx, 1, {
      tone: deleted ? 'success' : 'warning',
      text: deleted
        ? t(ctx, 'admin_sales_discount_deleted', {
            name: escapeTelegramMarkdown(existing?.title ?? id),
          })
        : t(ctx, 'admin_sales_discount_not_found'),
    });
  });

  // Broadcast confirmation (shows exact recipient count before queueing!)
  registerAdminRoute(/^adm:dsc:bc:([a-zA-Z0-9_-]{1,64})$/u, async (ctx, match) => {
    if (!ctx.services) return;
    const id = match![1]!;
    const discount = await getCatalogDiscountService(ctx.services).getDiscountById(id);
    if (!discount) {
      await renderDiscountsListScreen(ctx, 1);
      return;
    }
    const count = await ctx.services.broadcastService.countAudience('all');
    await renderScreen(
      ctx,
      buildAdminScreen({
        emoji: '📣',
        title: t(ctx, 'admin_cdisc_bcast_confirm_title'),
        primary: {
          emoji: '🔥',
          label: t(ctx, 'admin_sales_discount_title_label'),
          value: escapeTelegramMarkdown(discount.title),
          inline: true,
        },
        footer: t(ctx, 'admin_cdisc_bcast_confirm_body', {
          count: localizedNumber(count, ctx),
        }),
      }),
      {
        parse_mode: 'Markdown',
        reply_markup: buildAdminConfirmKeyboard(ctx, {
          confirmCallback: `adm:dsc:bc_ok:${id}`,
          cancelCallback: `adm:dsc:v:${id}`,
          confirmLabel: t(ctx, 'admin_cdisc_bcast_confirm_button'),
        }),
      }
    );
  });

  registerAdminRoute(/^adm:dsc:bc_ok:([a-zA-Z0-9_-]{1,64})$/u, async (ctx, match) => {
    if (!ctx.services || !ctx.from) return;
    const id = match![1]!;
    const discount = await getCatalogDiscountService(ctx.services).getDiscountById(id);
    if (!discount) {
      await renderDiscountsListScreen(ctx, 1);
      return;
    }
    let resolvedTargetName: string | undefined;
    if (discount.scope === 'category' && discount.targetId) {
      const cat = await ctx.services.packageCategoryService
        ?.getCategoryById(discount.targetId)
        .catch(() => null);
      if (cat) resolvedTargetName = `${cat.icon ? `${cat.icon} ` : ''}${cat.name}`;
    } else if (discount.scope === 'package' && discount.targetId) {
      resolvedTargetName = loadPackages(ctx).find((p) => p.id === discount.targetId)?.name;
    }
    const description = `${formatDiscountValue(ctx, discount)} · ${formatDiscountScope(ctx, discount, resolvedTargetName)}`;
    const dateStr = discount.expiresAt ? localizedDate(new Date(discount.expiresAt), ctx) : '∞';
    const message = t(ctx, 'admin_sales_discount_broadcast_template', {
      name: escapeTelegramMarkdown(discount.title),
      description,
      date: dateStr,
    });
    const job = await ctx.services.broadcastService.createJob({
      actorTelegramId: ctx.from.id,
      audience: 'all',
      message,
    });
    await renderDiscountDetailScreen(ctx, id, {
      tone: 'success',
      text: t(ctx, 'admin_sales_discount_broadcast_queued', {
        count: localizedNumber(job.recipientCount, ctx),
      }),
    });
  });

  // Discount single-field edit + quick presets
  registerAdminRoute(
    /^adm:dsc:ep:(24h|3d|7d|30d|never|nocap):([a-zA-Z0-9_-]{1,64})$/u,
    async (ctx, match) => {
      if (!ctx.services) return;
      const preset = match![1]!;
      const id = match![2]!;
      const service = getCatalogDiscountService(ctx.services);
      const now = Date.now();
      const msMap: Record<string, number> = {
        '24h': 24 * 3_600_000,
        '3d': 3 * 24 * 3_600_000,
        '7d': 7 * 24 * 3_600_000,
        '30d': 30 * 24 * 3_600_000,
      };
      try {
        if (preset === 'nocap') {
          await service.updateDiscount(id, { maxDiscountAmount: null });
        } else if (preset === 'never') {
          await service.updateDiscount(id, { expiresAt: null });
        } else {
          await service.updateDiscount(id, { expiresAt: new Date(now + msMap[preset]!) });
        }
        await renderDiscountDetailScreen(ctx, id, {
          tone: 'success',
          text: t(ctx, 'admin_cdisc_saved_notice'),
        });
      } catch {
        await renderDiscountDetailScreen(ctx, id, {
          tone: 'error',
          text: t(ctx, 'admin_cdisc_invalid_input'),
        });
      }
    }
  );

  registerAdminRoute(
    /^adm:dsc:ed:(title|val|cap|exp):([a-zA-Z0-9_-]{1,64})$/u,
    async (ctx, match) => {
      if (!ctx.services) return;
      const field = match![1]!;
      const id = match![2]!;
      const discount = await getCatalogDiscountService(ctx.services).getDiscountById(id);
      if (!discount) {
        await renderDiscountsListScreen(ctx, 1);
        return;
      }
      const promptKeyMap: Record<string, string> = {
        title: 'admin_sales_discount_title_prompt',
        val: 'admin_sales_discount_value_prompt',
        cap: 'admin_sales_discount_max_cap_prompt',
        exp: 'admin_sales_discount_expiry_prompt',
      };
      const keyboard = adminInputCancelKeyboard(ctx, (kb) => {
        if (field === 'cap') {
          kb.text(t(ctx, 'admin_promo_preset_no_cap'), `adm:dsc:ep:nocap:${id}`).row();
        } else if (field === 'exp') {
          kb.text(t(ctx, 'admin_cdisc_preset_24h'), `adm:dsc:ep:24h:${id}`)
            .text(t(ctx, 'admin_cdisc_preset_3d'), `adm:dsc:ep:3d:${id}`)
            .row()
            .text(t(ctx, 'admin_cdisc_preset_7d'), `adm:dsc:ep:7d:${id}`)
            .text(t(ctx, 'admin_cdisc_preset_30d'), `adm:dsc:ep:30d:${id}`)
            .row()
            .text(t(ctx, 'admin_promo_preset_never'), `adm:dsc:ep:never:${id}`)
            .row();
        }
      });
      await startAdminInput(ctx, {
        kind: 'dsc:edit_field',
        payload: { id, field },
        returnRoute: `adm:dsc:v:${id}`,
        promptText: buildAdminPromptScreen({
          emoji: '✏️',
          title: escapeTelegramMarkdown(discount.title),
          body: t(ctx, promptKeyMap[field]!),
        }),
        keyboard,
      });
    }
  );

  registerAdminInputHandler('dsc:edit_field', async (ctx, rawText, state) => {
    if (!ctx.services) return { status: 'done' };
    const id = String(state.payload?.id ?? '');
    const field = String(state.payload?.field ?? '');
    const service = getCatalogDiscountService(ctx.services);
    const existing = await service.getDiscountById(id);
    if (!existing) return { status: 'done', redirectRoute: 'adm:dsc:p:1' };

    const promptKeyMap: Record<string, string> = {
      title: 'admin_sales_discount_title_prompt',
      val: 'admin_sales_discount_value_prompt',
      cap: 'admin_sales_discount_max_cap_prompt',
      exp: 'admin_sales_discount_expiry_prompt',
    };
    const retry = () => ({
      status: 'retry' as const,
      promptText: buildAdminPromptScreen({
        emoji: '✏️',
        title: escapeTelegramMarkdown(existing.title),
        body: t(ctx, promptKeyMap[field] ?? 'admin_sales_discount_title_prompt'),
        error: t(ctx, 'admin_cdisc_invalid_input'),
      }),
    });

    try {
      if (field === 'title') {
        const title = rawText.trim();
        if (title.length < 1 || title.length > 120) return retry();
        await service.updateDiscount(id, { title });
      } else if (field === 'val') {
        const value = parsePosInt(rawText);
        if (value === undefined || (existing.discountType === 'percent' && value > 100)) {
          return retry();
        }
        await service.updateDiscount(id, { value });
      } else if (field === 'cap') {
        const cap = parseNonNegInt(rawText);
        if (cap === undefined) return retry();
        await service.updateDiscount(id, { maxDiscountAmount: cap === 0 ? null : cap });
      } else if (field === 'exp') {
        const norm = normalizeInputDigits(rawText.trim()).toLowerCase();
        if (['0', '-', 'never', 'none', 'بدون'].includes(norm)) {
          await service.updateDiscount(id, { expiresAt: null });
        } else {
          const parsed = parseDateInput(norm, true);
          if (!parsed || parsed.getTime() <= new Date(existing.startsAt).getTime()) return retry();
          await service.updateDiscount(id, { expiresAt: parsed });
        }
      }
      return {
        status: 'done',
        redirectRoute: `adm:dsc:v:${id}`,
        notice: { tone: 'success', text: t(ctx, 'admin_cdisc_saved_notice') },
      };
    } catch {
      return retry();
    }
  });

  // Stateless Flash Discount creation flow
  registerAdminRoute('adm:dsc:add', async (ctx) => {
    if (ctx.session) {
      ctx.session.adminDraft = { kind: 'dsc_add' } satisfies DiscountDraft;
    }
    await startAdminInput(ctx, {
      kind: 'dsc:add:title',
      returnRoute: 'adm:dsc:p:1',
      promptText: buildAdminPromptScreen({
        emoji: '🔥',
        title: t(ctx, 'admin_sales_discount_create_button'),
        body: t(ctx, 'admin_sales_discount_title_prompt'),
      }),
    });
  });

  registerAdminInputHandler('dsc:add:title', async (ctx, rawText) => {
    const title = rawText.trim();
    if (title.length < 1 || title.length > 120) {
      return {
        status: 'retry',
        promptText: buildAdminPromptScreen({
          emoji: '🔥',
          title: t(ctx, 'admin_sales_discount_create_button'),
          body: t(ctx, 'admin_sales_discount_title_prompt'),
          error: t(ctx, 'admin_cdisc_invalid_input'),
        }),
      };
    }
    if (ctx.session) {
      ctx.session.adminDraft = { kind: 'dsc_add', title } as unknown as Record<string, unknown>;
    }
    const kb = new InlineKeyboard()
      .text(t(ctx, 'admin_sales_discount_scope_all'), 'adm:dsc:add:sc:all')
      .row()
      .text(t(ctx, 'admin_sales_discount_scope_category'), 'adm:dsc:add:sc:category')
      .text(t(ctx, 'admin_sales_discount_scope_package'), 'adm:dsc:add:sc:package')
      .row()
      .text(t(ctx, 'menu_cancel'), 'adm:dsc:p:1');
    await renderScreen(
      ctx,
      buildAdminPromptScreen({
        emoji: '🎯',
        title: escapeTelegramMarkdown(title),
        body: t(ctx, 'admin_sales_discount_scope_prompt'),
      }),
      { parse_mode: 'Markdown', reply_markup: kb }
    );
    return { status: 'handled' };
  });

  const renderDiscountTypePicker = async (ctx: MenuContext, draft: DiscountDraft) => {
    const kb = new InlineKeyboard()
      .text(t(ctx, 'admin_sales_discount_type_percent'), 'adm:dsc:add:ty:percent')
      .text(t(ctx, 'admin_sales_discount_type_fixed'), 'adm:dsc:add:ty:fixed')
      .row()
      .text(t(ctx, 'menu_cancel'), 'adm:dsc:p:1');
    await renderScreen(
      ctx,
      buildAdminPromptScreen({
        emoji: '💰',
        title: escapeTelegramMarkdown(draft.title ?? t(ctx, 'admin_sales_discounts_title')),
        body: t(ctx, 'admin_sales_discount_type_prompt'),
      }),
      { parse_mode: 'Markdown', reply_markup: kb }
    );
  };

  registerAdminRoute(/^adm:dsc:add:sc:(all|category|package)$/u, async (ctx, match) => {
    const scope = match![1] as CatalogDiscountScope;
    const draft = (ctx.session?.adminDraft as DiscountDraft | undefined) ?? { kind: 'dsc_add' };
    draft.scope = scope;
    draft.targetId = null;
    if (ctx.session) ctx.session.adminDraft = draft as unknown as Record<string, unknown>;

    if (scope === 'all') {
      await renderDiscountTypePicker(ctx, draft);
      return;
    }

    if (scope === 'category') {
      const cats = (await ctx.services?.packageCategoryService?.listCategories(true)) ?? [];
      if (cats.length === 0) {
        await renderDiscountsListScreen(ctx, 1, {
          tone: 'warning',
          text: t(ctx, 'shop_category_empty'),
        });
        return;
      }
      const kb = new InlineKeyboard();
      for (const c of cats.slice(0, 12)) {
        kb.text(
          truncateButtonLabel(`${c.icon ? `${c.icon} ` : ''}${c.name}`),
          `adm:dsc:add:tg:${c.id}`
        ).row();
      }
      kb.text(t(ctx, 'menu_cancel'), 'adm:dsc:p:1');
      await renderScreen(
        ctx,
        buildAdminPromptScreen({
          emoji: '📦',
          title: escapeTelegramMarkdown(draft.title ?? t(ctx, 'admin_sales_discounts_title')),
          body: t(ctx, 'admin_sales_discount_target_prompt'),
        }),
        { parse_mode: 'Markdown', reply_markup: kb }
      );
      return;
    }

    const pkgs = loadPackages(ctx);
    if (pkgs.length === 0) {
      await renderDiscountsListScreen(ctx, 1, {
        tone: 'warning',
        text: t(ctx, 'shop_empty_message'),
      });
      return;
    }
    const kb = new InlineKeyboard();
    for (const p of pkgs.slice(0, 12)) {
      kb.text(truncateButtonLabel(p.name), `adm:dsc:add:tg:${p.id}`).row();
    }
    kb.text(t(ctx, 'menu_cancel'), 'adm:dsc:p:1');
    await renderScreen(
      ctx,
      buildAdminPromptScreen({
        emoji: '📦',
        title: escapeTelegramMarkdown(draft.title ?? t(ctx, 'admin_sales_discounts_title')),
        body: t(ctx, 'admin_sales_discount_target_prompt'),
      }),
      { parse_mode: 'Markdown', reply_markup: kb }
    );
  });

  registerAdminRoute(/^adm:dsc:add:tg:([a-zA-Z0-9_-]{1,64})$/u, async (ctx, match) => {
    const draft = (ctx.session?.adminDraft as DiscountDraft | undefined) ?? { kind: 'dsc_add' };
    draft.targetId = match![1]!;
    if (ctx.session) ctx.session.adminDraft = draft as unknown as Record<string, unknown>;
    await renderDiscountTypePicker(ctx, draft);
  });

  registerAdminRoute(/^adm:dsc:add:ty:(percent|fixed)$/u, async (ctx, match) => {
    const draft = (ctx.session?.adminDraft as DiscountDraft | undefined) ?? { kind: 'dsc_add' };
    draft.discountType = match![1] as CatalogDiscountType;
    if (ctx.session) ctx.session.adminDraft = draft as unknown as Record<string, unknown>;
    await startAdminInput(ctx, {
      kind: 'dsc:add:val',
      returnRoute: 'adm:dsc:p:1',
      promptText: buildAdminPromptScreen({
        emoji: '🔢',
        title: escapeTelegramMarkdown(draft.title ?? t(ctx, 'admin_sales_discounts_title')),
        body: t(ctx, 'admin_sales_discount_value_prompt'),
      }),
    });
  });

  const renderDiscountDurationPicker = async (ctx: MenuContext, draft: DiscountDraft) => {
    const kb = new InlineKeyboard()
      .text(t(ctx, 'admin_cdisc_preset_24h'), 'adm:dsc:add:dur:24h')
      .text(t(ctx, 'admin_cdisc_preset_3d'), 'adm:dsc:add:dur:3d')
      .row()
      .text(t(ctx, 'admin_cdisc_preset_7d'), 'adm:dsc:add:dur:7d')
      .text(t(ctx, 'admin_cdisc_preset_30d'), 'adm:dsc:add:dur:30d')
      .row()
      .text(t(ctx, 'admin_promo_preset_never'), 'adm:dsc:add:dur:never')
      .row()
      .text(t(ctx, 'menu_cancel'), 'adm:dsc:p:1');
    await startAdminInput(ctx, {
      kind: 'dsc:add:exp',
      returnRoute: 'adm:dsc:p:1',
      promptText: buildAdminPromptScreen({
        emoji: '⏳',
        title: escapeTelegramMarkdown(draft.title ?? t(ctx, 'admin_sales_discounts_title')),
        body: t(ctx, 'admin_sales_discount_expiry_prompt'),
      }),
      keyboard: kb,
    });
  };

  registerAdminInputHandler('dsc:add:val', async (ctx, rawText) => {
    const draft = (ctx.session?.adminDraft as DiscountDraft | undefined) ?? { kind: 'dsc_add' };
    const value = parsePosInt(rawText);
    if (value === undefined || (draft.discountType === 'percent' && value > 100)) {
      return {
        status: 'retry',
        promptText: buildAdminPromptScreen({
          emoji: '🔢',
          title: escapeTelegramMarkdown(draft.title ?? t(ctx, 'admin_sales_discounts_title')),
          body: t(ctx, 'admin_sales_discount_value_prompt'),
          error: t(ctx, 'admin_cdisc_invalid_input'),
        }),
      };
    }
    draft.value = value;
    draft.maxDiscountAmount = null;
    if (ctx.session) ctx.session.adminDraft = draft as unknown as Record<string, unknown>;
    // Skip irrelevant MaxCap step for fixed discounts!
    if (draft.discountType === 'fixed') {
      await renderDiscountDurationPicker(ctx, draft);
      return { status: 'handled' };
    }
    await startAdminInput(ctx, {
      kind: 'dsc:add:cap',
      returnRoute: 'adm:dsc:p:1',
      promptText: buildAdminPromptScreen({
        emoji: '🧱',
        title: escapeTelegramMarkdown(draft.title ?? t(ctx, 'admin_sales_discounts_title')),
        body: t(ctx, 'admin_sales_discount_max_cap_prompt'),
      }),
      keyboard: adminInputCancelKeyboard(ctx, (kb) => {
        kb.text(t(ctx, 'admin_promo_preset_no_cap'), 'adm:dsc:add:nocap').row();
      }),
    });
    return { status: 'handled' };
  });

  registerAdminRoute('adm:dsc:add:nocap', async (ctx) => {
    const draft = (ctx.session?.adminDraft as DiscountDraft | undefined) ?? { kind: 'dsc_add' };
    draft.maxDiscountAmount = null;
    if (ctx.session) ctx.session.adminDraft = draft as unknown as Record<string, unknown>;
    await renderDiscountDurationPicker(ctx, draft);
  });

  registerAdminInputHandler('dsc:add:cap', async (ctx, rawText) => {
    const draft = (ctx.session?.adminDraft as DiscountDraft | undefined) ?? { kind: 'dsc_add' };
    const cap = parseNonNegInt(rawText);
    if (cap === undefined) {
      return {
        status: 'retry',
        promptText: buildAdminPromptScreen({
          emoji: '🧱',
          title: escapeTelegramMarkdown(draft.title ?? t(ctx, 'admin_sales_discounts_title')),
          body: t(ctx, 'admin_sales_discount_max_cap_prompt'),
          error: t(ctx, 'admin_cdisc_invalid_input'),
        }),
      };
    }
    draft.maxDiscountAmount = cap === 0 ? null : cap;
    if (ctx.session) ctx.session.adminDraft = draft as unknown as Record<string, unknown>;
    await renderDiscountDurationPicker(ctx, draft);
    return { status: 'handled' };
  });

  const finalizeNewDiscount = async (
    ctx: MenuContext,
    expiresAt: Date | null
  ): Promise<CatalogDiscountRow | null> => {
    if (!ctx.services) return null;
    const draft = ctx.session?.adminDraft as DiscountDraft | undefined;
    if (!draft || draft.kind !== 'dsc_add' || !draft.title || !draft.value) return null;
    const created = await getCatalogDiscountService(ctx.services).createDiscount({
      title: draft.title,
      scope: draft.scope ?? 'all',
      targetId: draft.targetId ?? null,
      discountType: draft.discountType ?? 'percent',
      value: draft.value,
      maxDiscountAmount: draft.maxDiscountAmount ?? null,
      startsAt: new Date(),
      expiresAt,
      active: true,
    });
    if (ctx.session) delete ctx.session.adminDraft;
    return created;
  };

  registerAdminRoute(/^adm:dsc:add:dur:(24h|3d|7d|30d|never)$/u, async (ctx, match) => {
    const preset = match![1]!;
    const msMap: Record<string, number> = {
      '24h': 24 * 3_600_000,
      '3d': 3 * 24 * 3_600_000,
      '7d': 7 * 24 * 3_600_000,
      '30d': 30 * 24 * 3_600_000,
    };
    const expiresAt = preset === 'never' ? null : new Date(Date.now() + msMap[preset]!);
    const created = await finalizeNewDiscount(ctx, expiresAt);
    if (!created) {
      await renderDiscountsListScreen(ctx, 1, { tone: 'error', text: t(ctx, 'operation_failed') });
      return;
    }
    await renderDiscountDetailScreen(ctx, created.id, {
      tone: 'success',
      text: t(ctx, 'admin_sales_discount_created', { name: escapeTelegramMarkdown(created.title) }),
    });
  });

  registerAdminInputHandler('dsc:add:exp', async (ctx, rawText) => {
    const norm = normalizeInputDigits(rawText.trim()).toLowerCase();
    let expiresAt: Date | null | undefined;
    if (['0', '-', 'never', 'none', 'بدون'].includes(norm)) {
      expiresAt = null;
    } else {
      const parsed = parseDateInput(norm, true);
      if (parsed && parsed.getTime() > Date.now()) {
        expiresAt = parsed;
      }
    }
    if (expiresAt === undefined) {
      return {
        status: 'retry',
        promptText: buildAdminPromptScreen({
          emoji: '⏳',
          title: t(ctx, 'admin_sales_discounts_title'),
          body: t(ctx, 'admin_sales_discount_expiry_prompt'),
          error: t(ctx, 'admin_cdisc_invalid_input'),
        }),
      };
    }
    const created = await finalizeNewDiscount(ctx, expiresAt);
    if (!created) {
      return {
        status: 'done',
        redirectRoute: 'adm:dsc:p:1',
        notice: { tone: 'error', text: t(ctx, 'operation_failed') },
      };
    }
    return {
      status: 'done',
      redirectRoute: `adm:dsc:v:${created.id}`,
      notice: {
        tone: 'success',
        text: t(ctx, 'admin_sales_discount_created', {
          name: escapeTelegramMarkdown(created.title),
        }),
      },
    };
  });

  // Safety fallback screen helper reference (unused-export prevention)
  void buildAdminEmptyState;
}
