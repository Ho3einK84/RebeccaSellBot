import { InlineKeyboard, type Bot } from 'grammy';
import {
  RebeccaPanelInUseError,
  type RebeccaPanelServiceSummary,
  type RebeccaPanelSummary,
} from '../../../domain/services/RebeccaPanelRegistry.js';
import {
  MAX_INVENTORY_VALUE,
  type PanelCapacitySnapshot,
  type ServiceCapacitySnapshot,
} from '../../../domain/services/InventoryService.js';
import { validateRebeccaBaseUrl } from '../../../infra/rebeccaBaseUrl.js';
import type { MenuContext } from '../../types.js';
import { callbackData } from '../../callbackData.js';
import { localizedNumber, t } from '../../locale.js';
import {
  buildAdminEmptyState,
  buildAdminPromptScreen,
  buildAdminScreen,
  buildBreadcrumb,
  buildStatusBadge,
  deleteConsumedInputMessage,
  guardAdminCallbacks,
  normalizeInputDigits,
  renderScreen,
  type AdminScreenNotice,
  type UserScreenField,
} from '../../ui.js';
import { escapeTelegramMarkdown, sanitizeTelegramInlineCode } from '../../rendering.js';
import {
  appendAdminFooterNav,
  appendAdminPagination,
  buildAdminConfirmKeyboard,
  markAdminContext,
} from '../../admin/adminNav.js';
import { invalidatePanelHealthCache } from '../../admin/adminHome.js';
import { registerAdminRoute } from '../../admin/adminRouter.js';
import {
  adminInputCancelKeyboard,
  registerAdminInputHandler,
  startAdminInput,
} from '../../admin/adminInput.js';

const PANEL_ID_CAPTURE = '([a-z0-9_-]{3,40})';
const PANEL_PAGE_SIZE = 7;
const PANEL_SERVICE_PAGE_SIZE = 6;
const PANEL_SECRET_INPUT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_SERVICE_ID = 2_147_483_647;

type PanelEditAction =
  | 'name'
  | 'url'
  | 'api_key'
  | 'add_service'
  | 'max_configs'
  | 'stock_remaining'
  | 'daily_create_limit';
type PanelServiceAction = 'default' | 'custom' | 'toggle_enabled';
type LimitFieldCode = 'm' | 'q' | 'l';
const COMPACT_PANEL_EDIT_ACTIONS: Record<string, PanelEditAction> = {
  n: 'name',
  u: 'url',
  k: 'api_key',
  s: 'add_service',
  m: 'max_configs',
  q: 'stock_remaining',
  l: 'daily_create_limit',
};

function parseLimitTextInput(
  raw: string
): { valid: true; value: number | null } | { valid: false } {
  const trimmed = normalizeInputDigits(raw.trim()).toLowerCase();
  if (['-', 'unlimited', 'none', 'نامحدود', 'بی‌نهایت', 'بینهایت'].includes(trimmed)) {
    return { valid: true, value: null };
  }
  if (!/^\d+$/u.test(trimmed)) return { valid: false };
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_INVENTORY_VALUE) {
    return { valid: false };
  }
  return { valid: true, value: parsed };
}

function formatLimitPair(
  ctx: MenuContext,
  used: number,
  limit: number | null,
  percent?: number | null
): string {
  const usedStr = localizedNumber(used, ctx);
  if (limit === null) {
    return `${usedStr} / ♾️`;
  }
  const limitStr = localizedNumber(limit, ctx);
  return percent !== undefined && percent !== null
    ? `${usedStr} / ${limitStr} (${localizedNumber(percent, ctx)}%)`
    : `${usedStr} / ${limitStr}`;
}

function formatStockValue(ctx: MenuContext, stock: number | null): string {
  return stock === null ? t(ctx, 'unlimited') : localizedNumber(stock, ctx);
}

export function panelCallback(...parts: Array<string | number>): string {
  return callbackData('a', 'p', ...parts);
}

export async function renderPanelRegistry(
  ctx: MenuContext,
  requestedPage?: number,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  const panels = ctx.services.panelRegistry.listPanels();
  const totalPages = Math.max(1, Math.ceil(panels.length / PANEL_PAGE_SIZE));
  const savedPage = requestedPage ?? ctx.session?.adminPanelView?.page ?? 1;
  const page = Math.min(Math.max(1, Math.trunc(savedPage)), totalPages);
  if (ctx.session) {
    ctx.session.adminPanelView = { page };
  }
  const pagePanels = panels.slice((page - 1) * PANEL_PAGE_SIZE, page * PANEL_PAGE_SIZE);

  const [orphanSummary, fleetSnapshot] = await Promise.all([
    ctx.services.configReconciliationService?.getQueueSummary?.().catch(() => null),
    ctx.services.inventoryService?.getFleetCapacitySnapshot?.().catch(() => null),
  ]);
  const openOrphans = orphanSummary?.openTotal ?? 0;
  const orphanLabel =
    openOrphans > 0
      ? `${t(ctx, 'admin_menu_orphans')} (⚠️ ${localizedNumber(openOrphans, ctx)})`
      : t(ctx, 'admin_menu_orphans');

  const panelCapMap = new Map(fleetSnapshot?.panels.map((p) => [p.panelId, p]) ?? []);
  const keyboard = new InlineKeyboard();
  for (const panel of pagePanels) {
    const cap = panelCapMap.get(panel.id);
    const statusIcon = !panel.enabled ? '⚪️' : cap && !cap.isAvailableForCreate ? '🔴' : '🟢';
    const capSuffix =
      cap && cap.maxConfigs !== null
        ? ` [${localizedNumber(cap.activeConfigsCount + cap.reservedCount, ctx)}/${localizedNumber(cap.maxConfigs, ctx)}]`
        : '';
    keyboard
      .text(
        `${panel.isDefault ? '⭐ ' : ''}${statusIcon} ${panel.name}${capSuffix}`,
        panelCallback('v', panel.id)
      )
      .row();
  }
  appendAdminPagination(keyboard, ctx, {
    page,
    totalPages,
    pageCallback: (p) => panelCallback('page', p),
  });
  keyboard
    .text(t(ctx, 'admin_panel_add_button'), panelCallback('add'))
    .text(orphanLabel, 'adm:orp:p:1')
    .row();
  appendAdminFooterNav(keyboard, ctx, {
    backCallback: 'adm:home',
    backLabel: t(ctx, 'admin_menu_back_to_admin'),
  });

  const breadcrumb = buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_panels'));
  await renderPanelScreen(
    ctx,
    panels.length
      ? buildAdminScreen({
          emoji: '🖥️',
          title: t(ctx, 'admin_panel_registry_title'),
          breadcrumb,
          notice,
          primary: {
            label: t(ctx, 'admin_panel_registry_total_label'),
            value: localizedNumber(panels.length, ctx),
            inline: true,
            emphasizeValue: true,
          },
          footer:
            totalPages > 1
              ? `${localizedNumber(page, ctx)} / ${localizedNumber(totalPages, ctx)}`
              : undefined,
        })
      : buildAdminEmptyState(
          '🖥️',
          t(ctx, 'admin_panel_registry_empty_title'),
          t(ctx, 'admin_panel_registry_empty_subtitle'),
          { breadcrumb, notice }
        ),
    keyboard,
    'Markdown'
  );
}

export async function renderPanelDetail(
  ctx: MenuContext,
  panelId: string,
  options?: { lastPingMs?: number; isError?: boolean; notice?: AdminScreenNotice }
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  const panel = ctx.services.panelRegistry.getPanel(panelId);
  if (!panel) {
    const kb = new InlineKeyboard();
    appendAdminFooterNav(kb, ctx, {
      backCallback: 'adm:pnl:p:1',
      backLabel: t(ctx, 'admin_panel_back_list'),
      showHome: true,
    });
    await renderPanelScreen(
      ctx,
      buildAdminEmptyState(
        '⚠️',
        t(ctx, 'admin_panel_detail_title'),
        t(ctx, 'admin_panel_not_found'),
        {
          breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_panels')),
        }
      ),
      kb,
      'Markdown'
    );
    return;
  }
  const keyboard = buildPanelDetailKeyboard(ctx, panel);
  const text = await panelDetailText(ctx, panel, options);

  await renderPanelScreen(ctx, text, keyboard, 'Markdown');
}

export function buildPanelDetailKeyboard(
  ctx: MenuContext,
  panel: RebeccaPanelSummary
): InlineKeyboard {
  if (!ctx.services) throw new Error('BOT_SERVICES_UNAVAILABLE');
  const keyboard = new InlineKeyboard()
    .text(t(ctx, 'admin_panel_test_button'), panelCallback('t', panel.id))
    .text(
      t(ctx, panel.enabled ? 'admin_panel_disable_button' : 'admin_panel_enable_button'),
      panelCallback('g', panel.id, panel.enabled ? 0 : 1)
    )
    .row();

  if (!panel.isDefault && panel.enabled) {
    keyboard.text(t(ctx, 'admin_panel_make_default_button'), panelCallback('d', panel.id)).row();
  }

  keyboard
    .text(t(ctx, 'admin_panel_edit_name_button'), panelCallback('e', panel.id, 'n'))
    .text(t(ctx, 'admin_panel_edit_url_button'), panelCallback('e', panel.id, 'u'))
    .row()
    .text(t(ctx, 'admin_panel_edit_capacity_button'), panelCallback('e', panel.id, 'm'))
    .text(t(ctx, 'admin_panel_edit_stock_button'), panelCallback('e', panel.id, 'q'))
    .row()
    .text(t(ctx, 'admin_panel_edit_daily_limit_button'), panelCallback('e', panel.id, 'l'))
    .text(t(ctx, 'admin_panel_edit_key_button'), panelCallback('e', panel.id, 'k'))
    .row()
    .text(
      `${t(ctx, 'admin_panel_services_manage_button')} (${localizedNumber(panel.services.length, ctx)})`,
      panelCallback('sm', panel.id)
    )
    .text(t(ctx, 'admin_panel_delete_button'), panelCallback('x', panel.id))
    .row();
  appendAdminFooterNav(keyboard, ctx, {
    backCallback: 'a:p:open',
    backLabel: t(ctx, 'admin_panel_back_list'),
    showHome: true,
  });

  return keyboard;
}

async function panelDetailText(
  ctx: MenuContext,
  panel: RebeccaPanelSummary,
  options?: { lastPingMs?: number; isError?: boolean; notice?: AdminScreenNotice }
): Promise<string> {
  const customTarget = ctx.services?.pricingService.getCustomVolumeTarget();
  const [usageStats, fleetSnapshot] = await Promise.all([
    ctx.services?.panelRegistry.getPanelUsage(panel.id).catch(() => ({ activeConfigsCount: 0 })),
    ctx.services?.inventoryService?.getFleetCapacitySnapshot?.().catch(() => null),
  ]);
  const panelCap: PanelCapacitySnapshot | undefined = fleetSnapshot?.panels.find(
    (p) => p.panelId === panel.id
  );
  const packages = ctx.services?.pricingService.getPackages(panel.id, undefined, true) ?? [];

  const connectionFields: UserScreenField[] = [];

  if (options?.lastPingMs !== undefined) {
    connectionFields.push({
      emoji: options.isError ? '🔴' : '⚡️',
      label: t(ctx, 'admin_panel_status_label'),
      value: options.isError
        ? t(ctx, 'admin_panel_test_failed')
        : `${t(ctx, 'admin_panel_test_ok')} (${localizedNumber(options.lastPingMs, ctx)} ${t(ctx, 'admin_stats_latency_unit')})`,
    });
  }

  connectionFields.push(
    {
      label: t(ctx, 'admin_panel_endpoint_label'),
      value: panel.baseUrl ? `\`${sanitizeTelegramInlineCode(panel.baseUrl)}\`` : '—',
    },
    {
      label: t(ctx, 'admin_panel_credential_label'),
      value: t(ctx, `admin_panel_credential_${panel.credentialMode}`),
    }
  );

  const activeConfigsCount = panelCap?.activeConfigsCount ?? usageStats?.activeConfigsCount ?? 0;
  const maxConfigsVal = panelCap ? panelCap.maxConfigs : (panel.maxConfigs ?? null);
  const stockRemainingVal = panelCap ? panelCap.stockRemaining : (panel.stockRemaining ?? null);
  const dailyLimitVal = panelCap ? panelCap.dailyCreateLimit : (panel.dailyCreateLimit ?? null);
  const todayCreated = panelCap?.todayCreatedCount ?? 0;

  const statsFields: UserScreenField[] = [
    {
      label: t(ctx, 'admin_panel_configs_count_label'),
      value: localizedNumber(activeConfigsCount, ctx),
    },
    {
      label: t(ctx, 'admin_panel_capacity_label'),
      value: formatLimitPair(
        ctx,
        activeConfigsCount + (panelCap?.reservedCount ?? 0),
        maxConfigsVal,
        panelCap?.utilizationPercent
      ),
    },
    {
      label: t(ctx, 'admin_panel_stock_label'),
      value: formatStockValue(ctx, stockRemainingVal),
    },
    {
      label: t(ctx, 'admin_panel_daily_limit_label'),
      value: formatLimitPair(ctx, todayCreated, dailyLimitVal),
    },
    {
      label: t(ctx, 'admin_panel_packages_count_label'),
      value: localizedNumber(packages.length, ctx),
    },
    {
      label: t(ctx, 'admin_panel_services_count_label'),
      value: localizedNumber(panel.services.length, ctx),
    },
  ];

  const serviceSummaryFields: UserScreenField[] = panel.services.length
    ? panel.services.slice(0, 4).map((service) => {
        const isCustom =
          customTarget?.panelId === panel.id && customTarget?.serviceId === service.serviceId;
        const badges: string[] = [];
        if (service.isDefault) badges.push(t(ctx, 'admin_panel_service_default_badge'));
        if (isCustom) badges.push(t(ctx, 'admin_panel_service_custom_target_badge'));
        const badgeSuffix = badges.length ? ` (${badges.join(' · ')})` : '';
        return {
          emoji: service.isDefault ? '⭐' : isCustom ? '🎯' : '🔹',
          value: `[${service.serviceId}] ${escapeTelegramMarkdown(service.name)}${badgeSuffix}`,
        };
      })
    : [
        {
          value: t(ctx, 'admin_panel_no_services_label'),
        },
      ];

  const statusLabel = buildStatusBadge(
    ctx,
    panel.enabled ? 'active' : 'inactive',
    t(ctx, panel.enabled ? 'admin_panel_status_enabled' : 'admin_panel_status_disabled')
  );
  const defaultSuffix = panel.isDefault ? ` (${t(ctx, 'admin_panel_default_badge')})` : '';

  return buildAdminScreen({
    emoji: '🖥️',
    title: escapeTelegramMarkdown(panel.name),
    breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_panels')),
    notice: options?.notice,
    primary: {
      label: t(ctx, 'admin_panel_status_label'),
      value: `${statusLabel}${defaultSuffix}`.trim(),
      inline: true,
    },
    sections: [
      {
        title: t(ctx, 'admin_panel_connection_section'),
        fields: connectionFields,
      },
      {
        title: t(ctx, 'admin_panel_stats_section'),
        fields: statsFields,
      },
      {
        title: t(ctx, 'admin_panel_services_section'),
        fields: serviceSummaryFields,
      },
    ],
    footer:
      panel.services.length > 4
        ? `💡 ${t(ctx, 'admin_panel_more_services_hint', { count: localizedNumber(panel.services.length, ctx) })}`
        : undefined,
  });
}

export async function renderPanelServicesMenu(
  ctx: MenuContext,
  panelId: string,
  requestedPage = 1,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  const panel = ctx.services.panelRegistry.getPanel(panelId);
  if (!panel) {
    const kb = new InlineKeyboard();
    appendAdminFooterNav(kb, ctx, {
      backCallback: 'adm:pnl:p:1',
      backLabel: t(ctx, 'admin_panel_back_list'),
      showHome: true,
    });
    await renderPanelScreen(
      ctx,
      buildAdminEmptyState(
        '⚠️',
        t(ctx, 'admin_panel_detail_title'),
        t(ctx, 'admin_panel_not_found')
      ),
      kb,
      'Markdown'
    );
    return;
  }
  const keyboard = buildPanelServicesKeyboard(ctx, panel, requestedPage);
  const text = panelServicesMenuText(ctx, panel, requestedPage, notice);
  await renderPanelScreen(ctx, text, keyboard, 'Markdown');
}

export function buildPanelServicesKeyboard(
  ctx: MenuContext,
  panel: RebeccaPanelSummary,
  requestedPage = 1
): InlineKeyboard {
  if (!ctx.services) throw new Error('BOT_SERVICES_UNAVAILABLE');
  const customTarget = ctx.services.pricingService.getCustomVolumeTarget();
  const totalPages = Math.max(1, Math.ceil(panel.services.length / PANEL_SERVICE_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(requestedPage)), totalPages);
  const visibleServices = panel.services.slice(
    (page - 1) * PANEL_SERVICE_PAGE_SIZE,
    page * PANEL_SERVICE_PAGE_SIZE
  );

  const keyboard = new InlineKeyboard();
  for (const service of visibleServices) {
    const isCustomTarget =
      customTarget.panelId === panel.id && customTarget.serviceId === service.serviceId;
    const badge = service.isDefault ? '⭐' : isCustomTarget ? '🎯' : '🔹';
    keyboard
      .text(
        `${badge} [${service.serviceId}] ${service.name}`,
        panelCallback('sd', panel.id, service.serviceId)
      )
      .row();
  }

  appendAdminPagination(keyboard, ctx, {
    page,
    totalPages,
    pageCallback: (p) => panelCallback('sm', panel.id, p),
  });

  keyboard.text(t(ctx, 'admin_panel_add_service_button'), panelCallback('e', panel.id, 's')).row();
  appendAdminFooterNav(keyboard, ctx, {
    backCallback: panelCallback('v', panel.id),
    backLabel: t(ctx, 'admin_panel_back_detail'),
    showHome: true,
  });

  return keyboard;
}

function panelServicesMenuText(
  ctx: MenuContext,
  panel: RebeccaPanelSummary,
  requestedPage = 1,
  notice?: AdminScreenNotice
): string {
  const customTarget = ctx.services?.pricingService.getCustomVolumeTarget();
  const totalPages = Math.max(1, Math.ceil(panel.services.length / PANEL_SERVICE_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(requestedPage)), totalPages);
  const visibleServices = panel.services.slice(
    (page - 1) * PANEL_SERVICE_PAGE_SIZE,
    page * PANEL_SERVICE_PAGE_SIZE
  );

  const fields: UserScreenField[] = visibleServices.length
    ? visibleServices.map((service) => {
        const isCustom =
          customTarget?.panelId === panel.id && customTarget?.serviceId === service.serviceId;
        const badges: string[] = [];
        if (service.isDefault) badges.push(t(ctx, 'admin_panel_service_default_badge'));
        if (isCustom) badges.push(t(ctx, 'admin_panel_service_custom_target_badge'));
        const badgeSuffix = badges.length ? ` (${badges.join(' · ')})` : '';
        return {
          emoji: service.isDefault ? '⭐' : isCustom ? '🎯' : '🔹',
          value: `[${service.serviceId}] ${escapeTelegramMarkdown(service.name)}${badgeSuffix}`,
        };
      })
    : [
        {
          value: t(ctx, 'admin_panel_no_services_label'),
        },
      ];

  return buildAdminScreen({
    emoji: '📦',
    title: t(ctx, 'admin_panel_manage_services_title'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_home_title'),
      t(ctx, 'admin_nav_panels'),
      escapeTelegramMarkdown(panel.name)
    ),
    notice,
    sections: [
      {
        title: t(ctx, 'admin_panel_services_section'),
        fields,
      },
    ],
    footer:
      totalPages > 1
        ? `${localizedNumber(page, ctx)} / ${localizedNumber(totalPages, ctx)}`
        : undefined,
  });
}

export async function renderServiceDetail(
  ctx: MenuContext,
  panelId: string,
  serviceId: number,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  const panel = ctx.services.panelRegistry.getPanel(panelId);
  const service = panel?.services.find((s) => s.serviceId === serviceId);
  if (!panel || !service) {
    const kb = new InlineKeyboard();
    appendAdminFooterNav(kb, ctx, {
      backCallback: panelCallback('sm', panelId),
      backLabel: t(ctx, 'menu_back'),
      showHome: true,
    });
    await renderPanelScreen(
      ctx,
      buildAdminEmptyState(
        '⚠️',
        t(ctx, 'admin_panel_service_detail_title'),
        t(ctx, 'admin_panel_not_found')
      ),
      kb,
      'Markdown'
    );
    return;
  }
  const fleetSnapshot = await ctx.services.inventoryService
    ?.getFleetCapacitySnapshot?.()
    .catch(() => null);
  const serviceCap = fleetSnapshot?.panels
    .find((p) => p.panelId === panel.id)
    ?.services.find((s) => s.serviceId === service.serviceId);
  const keyboard = buildServiceDetailKeyboard(ctx, panel, service);
  const text = serviceDetailText(ctx, panel, service, notice, serviceCap);
  await renderPanelScreen(ctx, text, keyboard, 'Markdown');
}

export function buildServiceDetailKeyboard(
  ctx: MenuContext,
  panel: RebeccaPanelSummary,
  service: Pick<RebeccaPanelServiceSummary, 'serviceId' | 'name' | 'isDefault'> & {
    enabled?: boolean;
  }
): InlineKeyboard {
  if (!ctx.services) throw new Error('BOT_SERVICES_UNAVAILABLE');
  const customTarget = ctx.services.pricingService.getCustomVolumeTarget();
  const isCustomTarget =
    customTarget.panelId === panel.id && customTarget.serviceId === service.serviceId;
  const serviceEnabled = service.enabled !== false;

  const keyboard = new InlineKeyboard()
    .text(
      t(
        ctx,
        serviceEnabled ? 'admin_panel_service_pause_button' : 'admin_panel_service_resume_button'
      ),
      panelCallback('ss', 'e', panel.id, service.serviceId)
    )
    .row()
    .text(
      t(ctx, 'admin_panel_edit_capacity_button'),
      panelCallback('se', panel.id, service.serviceId, 'm')
    )
    .text(
      t(ctx, 'admin_panel_edit_stock_button'),
      panelCallback('se', panel.id, service.serviceId, 'q')
    )
    .row()
    .text(
      t(ctx, 'admin_panel_edit_daily_limit_button'),
      panelCallback('se', panel.id, service.serviceId, 'l')
    )
    .row();

  if (!service.isDefault) {
    keyboard
      .text(
        t(ctx, 'admin_panel_service_default_button'),
        panelCallback('ss', 'd', panel.id, service.serviceId)
      )
      .row();
  }

  keyboard
    .text(
      t(
        ctx,
        isCustomTarget
          ? 'admin_panel_custom_target_selected_button'
          : 'admin_panel_custom_target_button'
      ),
      panelCallback('ss', 'c', panel.id, service.serviceId)
    )
    .row();

  if (!service.isDefault && panel.services.length > 1) {
    keyboard
      .text(
        t(ctx, 'admin_panel_service_delete_button'),
        panelCallback('ss', 'x', panel.id, service.serviceId)
      )
      .row();
  }

  appendAdminFooterNav(keyboard, ctx, {
    backCallback: panelCallback('sm', panel.id),
    backLabel: t(ctx, 'menu_back'),
    showHome: true,
  });

  return keyboard;
}

function serviceDetailText(
  ctx: MenuContext,
  panel: RebeccaPanelSummary,
  service: Pick<RebeccaPanelServiceSummary, 'serviceId' | 'name' | 'isDefault'> & {
    enabled?: boolean;
    maxConfigs?: number | null;
    stockRemaining?: number | null;
    dailyCreateLimit?: number | null;
  },
  notice?: AdminScreenNotice,
  serviceCap?: ServiceCapacitySnapshot
): string {
  const customTarget = ctx.services?.pricingService.getCustomVolumeTarget();
  const isCustomTarget =
    customTarget?.panelId === panel.id && customTarget?.serviceId === service.serviceId;
  const serviceEnabled = serviceCap ? serviceCap.enabled : service.enabled !== false;
  const maxConfigsVal = serviceCap ? serviceCap.maxConfigs : (service.maxConfigs ?? null);
  const stockRemainingVal = serviceCap
    ? serviceCap.stockRemaining
    : (service.stockRemaining ?? null);
  const dailyLimitVal = serviceCap
    ? serviceCap.dailyCreateLimit
    : (service.dailyCreateLimit ?? null);

  const fields: UserScreenField[] = [
    {
      label: t(ctx, 'admin_panel_name_label'),
      value: escapeTelegramMarkdown(service.name),
    },
    {
      label: t(ctx, 'admin_panel_service_id_label'),
      value: `\`${service.serviceId}\``,
    },
    {
      label: t(ctx, 'admin_panel_service_status_label'),
      value: t(
        ctx,
        serviceEnabled ? 'admin_panel_service_enabled_badge' : 'admin_panel_service_paused_badge'
      ),
    },
    {
      label: t(ctx, 'admin_panel_capacity_label'),
      value: formatLimitPair(
        ctx,
        (serviceCap?.activeConfigsCount ?? 0) + (serviceCap?.reservedCount ?? 0),
        maxConfigsVal,
        serviceCap?.utilizationPercent
      ),
    },
    {
      label: t(ctx, 'admin_panel_stock_label'),
      value: formatStockValue(ctx, stockRemainingVal),
    },
    {
      label: t(ctx, 'admin_panel_daily_limit_label'),
      value: formatLimitPair(ctx, serviceCap?.todayCreatedCount ?? 0, dailyLimitVal),
    },
    {
      label: t(ctx, 'admin_panel_default_label'),
      value: service.isDefault ? t(ctx, 'admin_yes') : t(ctx, 'admin_no'),
    },
    {
      label: t(ctx, 'admin_panel_service_custom_target_badge'),
      value: isCustomTarget ? t(ctx, 'admin_yes') : t(ctx, 'admin_no'),
    },
  ];

  return buildAdminScreen({
    emoji: '🧩',
    title: t(ctx, 'admin_panel_service_detail_title'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_home_title'),
      t(ctx, 'admin_nav_panels'),
      escapeTelegramMarkdown(panel.name)
    ),
    notice,
    sections: [
      {
        title: t(ctx, 'admin_panel_services_section'),
        fields,
      },
    ],
    footer: isCustomTarget ? `💡 ${t(ctx, 'admin_panel_service_custom_target_desc')}` : undefined,
  });
}

function registerPanelInputHandlers(): void {
  registerAdminInputHandler('pnl:name', async (ctx, rawText, state) => {
    const panelId = String(state.payload?.panelId ?? '');
    const value = rawText.trim();
    if (!value || value.length > 80) {
      return {
        status: 'retry',
        promptText: buildAdminPromptScreen(
          '✏️',
          t(ctx, 'admin_panel_edit_name_button'),
          t(ctx, 'admin_panel_name_prompt'),
          {
            breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_panels')),
            error: t(ctx, 'admin_setting_invalid'),
          }
        ),
      };
    }
    try {
      await ctx.services!.panelRegistry.updatePanel(panelId, { name: value });
      invalidatePanelHealthCache(ctx.services?.panelRegistry);
      return {
        status: 'done',
        redirectRoute: `adm:pnl:v:${panelId}`,
        notice: { tone: 'success', text: t(ctx, 'admin_panel_saved') },
      };
    } catch {
      return {
        status: 'done',
        redirectRoute: `adm:pnl:v:${panelId}`,
        notice: { tone: 'error', text: t(ctx, 'admin_panel_save_failed') },
      };
    }
  });

  registerAdminInputHandler('pnl:url', async (ctx, rawText, state) => {
    const panelId = String(state.payload?.panelId ?? '');
    let normalizedUrl: string;
    try {
      normalizedUrl = validateRebeccaBaseUrl(rawText.trim());
    } catch {
      return {
        status: 'retry',
        promptText: buildAdminPromptScreen(
          '🌐',
          t(ctx, 'admin_panel_edit_url_button'),
          t(ctx, 'admin_panel_url_prompt'),
          {
            breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_panels')),
            error: t(ctx, 'admin_rebecca_url_invalid'),
          }
        ),
      };
    }
    try {
      await ctx.services!.panelRegistry.updatePanel(panelId, { baseUrl: normalizedUrl });
      invalidatePanelHealthCache(ctx.services?.panelRegistry);
      return {
        status: 'done',
        redirectRoute: `adm:pnl:v:${panelId}`,
        notice: { tone: 'success', text: t(ctx, 'admin_panel_saved') },
      };
    } catch {
      return {
        status: 'done',
        redirectRoute: `adm:pnl:v:${panelId}`,
        notice: { tone: 'error', text: t(ctx, 'admin_panel_save_failed') },
      };
    }
  });

  registerAdminInputHandler('pnl:add_svc_id', async (ctx, rawText, state) => {
    const panelId = String(state.payload?.panelId ?? '');
    const normalized = normalizeInputDigits(rawText.trim());
    const parsed = /^[1-9]\d*$/u.test(normalized) ? Number(normalized) : Number.NaN;
    if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_SERVICE_ID) {
      return {
        status: 'retry',
        promptText: buildAdminPromptScreen(
          '🔢',
          t(ctx, 'admin_panel_add_service_button'),
          t(ctx, 'admin_panel_service_id_prompt'),
          {
            breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_panels')),
            error: t(ctx, 'admin_setting_invalid'),
          }
        ),
      };
    }
    await startAdminInput(ctx, {
      kind: 'pnl:add_svc_name',
      payload: { panelId, serviceId: parsed },
      returnRoute: `adm:pnl:sm:${panelId}`,
      promptText: buildAdminPromptScreen(
        '✍️',
        t(ctx, 'admin_panel_add_service_button'),
        t(ctx, 'admin_panel_service_name_prompt'),
        {
          breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_panels')),
        }
      ),
    });
    return { status: 'handled' };
  });

  registerAdminInputHandler('pnl:add_svc_name', async (ctx, rawText, state) => {
    const panelId = String(state.payload?.panelId ?? '');
    const serviceId = Number(state.payload?.serviceId);
    const name = rawText.trim();
    if (!name || name.length > 80) {
      return {
        status: 'retry',
        promptText: buildAdminPromptScreen(
          '✍️',
          t(ctx, 'admin_panel_add_service_button'),
          t(ctx, 'admin_panel_service_name_prompt'),
          {
            breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_panels')),
            error: t(ctx, 'admin_setting_invalid'),
          }
        ),
      };
    }
    try {
      await ctx.services!.panelRegistry.addService(panelId, serviceId, name);
      return {
        status: 'done',
        redirectRoute: `adm:pnl:sm:${panelId}`,
        notice: { tone: 'success', text: t(ctx, 'admin_panel_saved') },
      };
    } catch {
      return {
        status: 'done',
        redirectRoute: `adm:pnl:sm:${panelId}`,
        notice: { tone: 'error', text: t(ctx, 'admin_panel_save_failed') },
      };
    }
  });

  registerAdminInputHandler('pnl:limit', async (ctx, rawText, state) => {
    const panelId = String(state.payload?.panelId ?? '');
    const field = String(state.payload?.field ?? 'm') as LimitFieldCode;
    const serviceIdRaw = state.payload?.serviceId;
    const serviceId = typeof serviceIdRaw === 'number' ? serviceIdRaw : undefined;
    const parsed = parseLimitTextInput(rawText);
    const promptKey =
      field === 'm'
        ? 'admin_panel_capacity_prompt'
        : field === 'q'
          ? 'admin_panel_stock_prompt'
          : 'admin_panel_daily_limit_prompt';
    const titleKey =
      field === 'm'
        ? 'admin_panel_edit_capacity_button'
        : field === 'q'
          ? 'admin_panel_edit_stock_button'
          : 'admin_panel_edit_daily_limit_button';
    const redirectRoute =
      serviceId !== undefined ? `adm:pnl:sd:${panelId}:${serviceId}` : `adm:pnl:v:${panelId}`;

    if (!parsed.valid) {
      return {
        status: 'retry',
        promptText: buildAdminPromptScreen(
          '📊',
          t(ctx, titleKey),
          t(ctx, promptKey, { current: String(state.payload?.currentDisplay ?? '—') }),
          {
            breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_panels')),
            error: t(ctx, 'admin_setting_invalid'),
          }
        ),
      };
    }
    const changes =
      field === 'm'
        ? { maxConfigs: parsed.value }
        : field === 'q'
          ? { stockRemaining: parsed.value }
          : { dailyCreateLimit: parsed.value };
    try {
      if (serviceId !== undefined) {
        await ctx.services!.panelRegistry.updateService(panelId, serviceId, changes);
      } else {
        await ctx.services!.panelRegistry.updatePanel(panelId, changes);
      }
      return {
        status: 'done',
        redirectRoute,
        notice: { tone: 'success', text: t(ctx, 'admin_panel_saved') },
      };
    } catch {
      return {
        status: 'done',
        redirectRoute,
        notice: { tone: 'error', text: t(ctx, 'admin_panel_save_failed') },
      };
    }
  });
}

export function registerAdminPanelRoutes(bot: Bot<MenuContext>): void {
  const adminCallback = guardAdminCallbacks(bot);
  registerPanelInputHandlers();

  // Unified `adm:pnl:*` routes
  registerAdminRoute(/^adm:pnl:p:(\d+)$/u, async (ctx, match, notice) => {
    await renderPanelRegistry(ctx, Number(match?.[1]) || 1, notice);
  });
  registerAdminRoute(
    new RegExp(`^adm:pnl:v:${PANEL_ID_CAPTURE}$`, 'u'),
    async (ctx, match, notice) => {
      await renderPanelDetail(ctx, match![1]!, { notice });
    }
  );
  registerAdminRoute(
    new RegExp(`^adm:pnl:sm:${PANEL_ID_CAPTURE}(?::(\\d+))?$`, 'u'),
    async (ctx, match, notice) => {
      await renderPanelServicesMenu(ctx, match![1]!, Number(match![2]) || 1, notice);
    }
  );
  registerAdminRoute(
    new RegExp(`^adm:pnl:sd:${PANEL_ID_CAPTURE}:(\\d+)$`, 'u'),
    async (ctx, match, notice) => {
      await renderServiceDetail(ctx, match![1]!, Number(match![2]), notice);
    }
  );
  registerAdminRoute(
    new RegExp(`^adm:pnl:dis_ok:${PANEL_ID_CAPTURE}$`, 'u'),
    async (ctx, match) => {
      await setPanelEnabled(ctx, match![1]!, false);
    }
  );

  // Compact callbacks keep the longest valid panel/service action below Telegram's
  // 64-byte callback-data limit. Older admin:* routes remain below for compatibility.
  adminCallback('a:p:open', async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderPanelRegistry(ctx);
  });
  adminCallback('a:p:n', async (ctx) => ctx.answerCallbackQuery());
  adminCallback(/^a:p:page:(\d+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderPanelRegistry(ctx, Number(ctx.match[1]) || 1);
  });
  adminCallback('a:p:add', startPanelAdd);
  adminCallback(new RegExp(`^a:p:v:${PANEL_ID_CAPTURE}$`, 'u'), async (ctx) => {
    clearPendingPanelSecret(ctx);
    await ctx.answerCallbackQuery();
    await renderPanelDetail(ctx, ctx.match[1]!);
  });
  adminCallback(new RegExp(`^a:p:sm:${PANEL_ID_CAPTURE}(?::(\\d+))?$`, 'u'), async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderPanelServicesMenu(ctx, ctx.match[1]!, Number(ctx.match[2]) || 1);
  });
  adminCallback(new RegExp(`^a:p:sd:${PANEL_ID_CAPTURE}:(\\d+)$`, 'u'), async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderServiceDetail(ctx, ctx.match[1]!, Number(ctx.match[2]));
  });
  adminCallback(new RegExp(`^a:p:ss:([dcxe]):${PANEL_ID_CAPTURE}:(\\d+)$`, 'u'), async (ctx) => {
    if (!ctx.services) return;
    const action = ctx.match[1]!;
    const panelId = ctx.match[2]!;
    const serviceId = Number(ctx.match[3]);
    if (action === 'x') {
      await promptPanelServiceDeletion(ctx, panelId, serviceId);
      return;
    }
    const mapped: PanelServiceAction =
      action === 'd' ? 'default' : action === 'c' ? 'custom' : 'toggle_enabled';
    await updatePanelService(ctx, mapped, panelId, serviceId);
  });
  adminCallback(new RegExp(`^a:p:ss:xc:${PANEL_ID_CAPTURE}:(\\d+)$`, 'u'), async (ctx) => {
    await deletePanelService(ctx, ctx.match[1]!, Number(ctx.match[2]));
  });
  adminCallback(new RegExp(`^a:p:e:${PANEL_ID_CAPTURE}:([nuksmql])$`, 'u'), async (ctx) => {
    await beginPanelEdit(ctx, ctx.match[1]!, COMPACT_PANEL_EDIT_ACTIONS[ctx.match[2]!]!);
  });
  adminCallback(new RegExp(`^a:p:eu:${PANEL_ID_CAPTURE}:([mql])$`, 'u'), async (ctx) => {
    if (!ctx.services) return;
    const panelId = ctx.match[1]!;
    const field = ctx.match[2]! as LimitFieldCode;
    if (ctx.session) delete ctx.session.adminInput;
    const changes =
      field === 'm'
        ? { maxConfigs: null }
        : field === 'q'
          ? { stockRemaining: null }
          : { dailyCreateLimit: null };
    try {
      await ctx.services.panelRegistry.updatePanel(panelId, changes);
      await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_saved') });
      await renderPanelDetail(ctx, panelId, {
        notice: { tone: 'success', text: t(ctx, 'admin_panel_saved') },
      });
    } catch {
      await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_save_failed'), show_alert: true });
    }
  });
  adminCallback(new RegExp(`^a:p:se:${PANEL_ID_CAPTURE}:(\\d+):([mql])$`, 'u'), async (ctx) => {
    await beginServiceLimitEdit(
      ctx,
      ctx.match[1]!,
      Number(ctx.match[2]),
      ctx.match[3]! as LimitFieldCode
    );
  });
  adminCallback(new RegExp(`^a:p:su:${PANEL_ID_CAPTURE}:(\\d+):([mql])$`, 'u'), async (ctx) => {
    if (!ctx.services) return;
    const panelId = ctx.match[1]!;
    const serviceId = Number(ctx.match[2]);
    const field = ctx.match[3]! as LimitFieldCode;
    if (ctx.session) delete ctx.session.adminInput;
    const changes =
      field === 'm'
        ? { maxConfigs: null }
        : field === 'q'
          ? { stockRemaining: null }
          : { dailyCreateLimit: null };
    try {
      await ctx.services.panelRegistry.updateService(panelId, serviceId, changes);
      await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_saved') });
      await renderServiceDetail(ctx, panelId, serviceId, {
        tone: 'success',
        text: t(ctx, 'admin_panel_saved'),
      });
    } catch {
      await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_save_failed'), show_alert: true });
    }
  });
  adminCallback(new RegExp(`^a:p:t:${PANEL_ID_CAPTURE}$`, 'u'), async (ctx) => {
    await testPanelConnection(ctx, ctx.match[1]!);
  });
  adminCallback(new RegExp(`^a:p:g:${PANEL_ID_CAPTURE}:([01])$`, 'u'), async (ctx) => {
    const panelId = ctx.match[1]!;
    const enable = ctx.match[2] === '1';
    if (!enable) {
      await promptPanelDisable(ctx, panelId);
      return;
    }
    await setPanelEnabled(ctx, panelId, true);
  });
  adminCallback(new RegExp(`^a:p:d:${PANEL_ID_CAPTURE}$`, 'u'), async (ctx) => {
    await setDefaultPanel(ctx, ctx.match[1]!);
  });
  adminCallback(new RegExp(`^a:p:s:([dcx]):${PANEL_ID_CAPTURE}:(\\d+)$`, 'u'), async (ctx) => {
    if (!ctx.services) return;
    const action = ctx.match[1]!;
    const panelId = ctx.match[2]!;
    const serviceId = Number(ctx.match[3]);
    if (action === 'x') {
      await promptPanelServiceDeletion(ctx, panelId, serviceId);
      return;
    }
    await updatePanelService(ctx, action === 'd' ? 'default' : 'custom', panelId, serviceId);
  });
  adminCallback(new RegExp(`^a:p:s:xc:${PANEL_ID_CAPTURE}:(\\d+)$`, 'u'), async (ctx) => {
    await deletePanelService(ctx, ctx.match[1]!, Number(ctx.match[2]));
  });
  adminCallback(new RegExp(`^a:p:x:${PANEL_ID_CAPTURE}$`, 'u'), async (ctx) => {
    await promptPanelDeletion(ctx, ctx.match[1]!);
  });
  adminCallback(new RegExp(`^a:p:xc:${PANEL_ID_CAPTURE}$`, 'u'), async (ctx) => {
    await deletePanel(ctx, ctx.match[1]!);
  });

  adminCallback('admin:panels:open', async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderPanelRegistry(ctx);
  });
  adminCallback('admin:panel:noop', async (ctx) => ctx.answerCallbackQuery());
  adminCallback('admin:panel:add', startPanelAdd);
  adminCallback(
    new RegExp(`^admin:panel:view:${PANEL_ID_CAPTURE}(?::(\\d+))?$`, 'u'),
    async (ctx) => {
      await ctx.answerCallbackQuery();
      await renderPanelDetail(ctx, ctx.match[1]!);
    }
  );
  adminCallback(
    new RegExp(`^admin:panel:edit:${PANEL_ID_CAPTURE}:(name|url|api_key|add_service)$`, 'u'),
    async (ctx) => {
      await beginPanelEdit(ctx, ctx.match[1]!, ctx.match[2]! as PanelEditAction);
    }
  );
  adminCallback(new RegExp(`^admin:panel:test:${PANEL_ID_CAPTURE}$`, 'u'), async (ctx) => {
    await testPanelConnection(ctx, ctx.match[1]!);
  });
  adminCallback(new RegExp(`^admin:panel:toggle:${PANEL_ID_CAPTURE}:([01])$`, 'u'), async (ctx) => {
    const panelId = ctx.match[1]!;
    const enable = ctx.match[2] === '1';
    if (!enable) {
      await promptPanelDisable(ctx, panelId);
      return;
    }
    await setPanelEnabled(ctx, panelId, true);
  });
  adminCallback(new RegExp(`^admin:panel:default:${PANEL_ID_CAPTURE}$`, 'u'), async (ctx) => {
    await setDefaultPanel(ctx, ctx.match[1]!);
  });
  adminCallback(
    new RegExp(`^admin:panel:service:(default|custom|delete):${PANEL_ID_CAPTURE}:(\\d+)$`, 'u'),
    async (ctx) => {
      if (!ctx.services) return;
      const action = ctx.match[1]! as PanelServiceAction | 'delete';
      const panelId = ctx.match[2]!;
      const serviceId = Number(ctx.match[3]);
      if (action === 'delete') {
        await promptPanelServiceDeletion(ctx, panelId, serviceId);
        return;
      }
      await updatePanelService(ctx, action, panelId, serviceId);
    }
  );
  adminCallback(
    new RegExp(`^admin:panel:service:delete_confirm:${PANEL_ID_CAPTURE}:(\\d+)$`, 'u'),
    async (ctx) => {
      await deletePanelService(ctx, ctx.match[1]!, Number(ctx.match[2]));
    }
  );
  adminCallback(new RegExp(`^admin:panel:delete:${PANEL_ID_CAPTURE}$`, 'u'), async (ctx) => {
    await promptPanelDeletion(ctx, ctx.match[1]!);
  });
  adminCallback(
    new RegExp(`^admin:panel:delete_confirm:${PANEL_ID_CAPTURE}$`, 'u'),
    async (ctx) => {
      await deletePanel(ctx, ctx.match[1]!);
    }
  );

  // API keys bypass Conversation replay persistence. This one-shot handler
  // explicitly removes the consumed secret message; ordinary user text is never
  // deleted globally by the UI middleware.
  bot.on('message:text', async (ctx, next) => {
    const action = ctx.session.adminPanelAction;
    if (action !== 'await_add_key' && action !== 'await_api_key') return next();
    if (!ctx.services?.isAdmin(ctx.from.id)) return;

    const actionAt = ctx.session.adminPanelActionAt;
    if (actionAt && Date.now() - actionAt > PANEL_SECRET_INPUT_TIMEOUT_MS) {
      clearPendingPanelSecret(ctx);
      return next();
    }

    const apiKey = ctx.message.text.trim();
    if (apiKey.startsWith('/') && apiKey !== '/cancel') {
      clearPendingPanelSecret(ctx);
      return next();
    }

    const panelIdForReturn = ctx.session.adminPanelId;
    const cancelKb = new InlineKeyboard();
    appendAdminFooterNav(cancelKb, ctx, {
      backCallback: panelIdForReturn ? panelCallback('v', panelIdForReturn) : 'adm:pnl:p:1',
      backLabel: panelIdForReturn
        ? t(ctx, 'admin_panel_back_detail')
        : t(ctx, 'admin_panel_back_list'),
      showHome: true,
    });

    if (apiKey === '/cancel') {
      await deleteConsumedInputMessage(ctx);
      clearPendingPanelSecret(ctx);
      await renderPanelScreen(
        ctx,
        buildAdminEmptyState(
          '↩️',
          t(ctx, 'admin_panel_api_key_title'),
          t(ctx, 'operation_cancelled')
        ),
        cancelKb,
        'Markdown'
      );
      return;
    }
    await deleteConsumedInputMessage(ctx);
    if (!apiKey || apiKey.length > 512 || /\s/u.test(apiKey)) {
      await renderPanelScreen(
        ctx,
        buildAdminPromptScreen(
          '🔐',
          t(ctx, 'admin_panel_api_key_title'),
          t(ctx, 'admin_panel_api_key_prompt'),
          {
            breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_panels')),
            error: t(ctx, 'admin_setting_invalid'),
          }
        ),
        cancelKb,
        'Markdown'
      );
      return;
    }

    try {
      let savedPanelId = panelIdForReturn;
      if (action === 'await_add_key') {
        const draft = ctx.session.adminPanelDraft;
        if (!draft) throw new Error('PANEL_DRAFT_MISSING');
        const created = await ctx.services.panelRegistry.createPanel({ ...draft, apiKey });
        savedPanelId = created?.id ?? savedPanelId;
      } else {
        if (!savedPanelId) throw new Error('PANEL_NOT_FOUND');
        await ctx.services.panelRegistry.updatePanel(savedPanelId, { apiKey });
      }
      clearPendingPanelSecret(ctx);
      invalidatePanelHealthCache(ctx.services.panelRegistry);

      const savedKb = new InlineKeyboard();
      if (savedPanelId) {
        savedKb
          .text(t(ctx, 'admin_panel_test_button'), panelCallback('t', savedPanelId))
          .text(t(ctx, 'admin_panel_back_detail'), panelCallback('v', savedPanelId))
          .row();
      }
      appendAdminFooterNav(savedKb, ctx, {
        backCallback: 'adm:pnl:p:1',
        backLabel: t(ctx, 'admin_panel_back_list'),
        showHome: true,
      });

      await renderPanelScreen(
        ctx,
        buildAdminScreen({
          emoji: '✅',
          title: t(ctx, 'admin_panel_saved_title'),
          breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_panels')),
          subtitle: t(ctx, 'admin_panel_saved_subtitle'),
          primary: {
            label: t(ctx, 'admin_panel_credential_label'),
            value: buildStatusBadge(ctx, 'active'),
            inline: true,
          },
        }),
        savedKb,
        'Markdown'
      );
    } catch {
      // Retain only the non-secret draft/action for a corrected-key retry.
      await renderPanelScreen(
        ctx,
        buildAdminPromptScreen(
          '⚠️',
          t(ctx, 'admin_panel_save_failed_title'),
          t(ctx, 'admin_panel_api_key_prompt'),
          {
            breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_panels')),
            error: t(ctx, 'admin_panel_save_failed'),
          }
        ),
        cancelKb,
        'Markdown'
      );
    }
  });
}

async function startPanelAdd(ctx: MenuContext): Promise<void> {
  ctx.session.adminPanelAction = 'add';
  ctx.session.adminPanelId = undefined;
  ctx.session.adminPanelDraft = undefined;
  await ctx.answerCallbackQuery();
  await ctx.conversation.enter('adminPanelConversation');
}

async function beginPanelEdit(
  ctx: MenuContext,
  panelId: string,
  action: PanelEditAction
): Promise<void> {
  const panel = ctx.services?.panelRegistry.getPanel(panelId);
  ctx.session.adminPanelId = panelId;
  await ctx.answerCallbackQuery();

  if (action === 'api_key') {
    ctx.session.adminPanelAction = 'await_api_key';
    ctx.session.adminPanelActionAt = Date.now();
    const cancelKb = new InlineKeyboard();
    appendAdminFooterNav(cancelKb, ctx, {
      backCallback: panelCallback('v', panelId),
      backLabel: t(ctx, 'admin_panel_back_detail'),
      showHome: true,
    });
    await renderPanelScreen(
      ctx,
      buildAdminPromptScreen(
        '🔐',
        t(ctx, 'admin_panel_api_key_title'),
        t(ctx, 'admin_panel_api_key_prompt'),
        {
          breadcrumb: buildBreadcrumb(
            t(ctx, 'admin_home_title'),
            t(ctx, 'admin_nav_panels'),
            panel ? escapeTelegramMarkdown(panel.name) : undefined
          ),
        }
      ),
      cancelKb,
      'Markdown'
    );
    return;
  }

  if (action === 'name') {
    await startAdminInput(ctx, {
      kind: 'pnl:name',
      payload: { panelId },
      returnRoute: `adm:pnl:v:${panelId}`,
      promptText: buildAdminPromptScreen(
        '✏️',
        t(ctx, 'admin_panel_edit_name_button'),
        t(ctx, 'admin_panel_name_prompt'),
        {
          breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_panels')),
          currentLabel: t(ctx, 'admin_panel_name_label'),
          currentValue: panel ? escapeTelegramMarkdown(panel.name) : undefined,
        }
      ),
    });
    return;
  }

  if (action === 'url') {
    await startAdminInput(ctx, {
      kind: 'pnl:url',
      payload: { panelId },
      returnRoute: `adm:pnl:v:${panelId}`,
      promptText: buildAdminPromptScreen(
        '🌐',
        t(ctx, 'admin_panel_edit_url_button'),
        t(ctx, 'admin_panel_url_prompt'),
        {
          breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_panels')),
          currentLabel: t(ctx, 'admin_panel_endpoint_label'),
          currentValue: panel?.baseUrl
            ? `\`${sanitizeTelegramInlineCode(panel.baseUrl)}\``
            : undefined,
        }
      ),
    });
    return;
  }

  if (action === 'add_service') {
    await startAdminInput(ctx, {
      kind: 'pnl:add_svc_id',
      payload: { panelId },
      returnRoute: `adm:pnl:sm:${panelId}`,
      promptText: buildAdminPromptScreen(
        '🔢',
        t(ctx, 'admin_panel_add_service_button'),
        t(ctx, 'admin_panel_service_id_prompt'),
        {
          breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_panels')),
        }
      ),
    });
    return;
  }

  if (action === 'max_configs' || action === 'stock_remaining' || action === 'daily_create_limit') {
    const field: LimitFieldCode =
      action === 'max_configs' ? 'm' : action === 'stock_remaining' ? 'q' : 'l';
    const currentNum =
      field === 'm'
        ? (panel?.maxConfigs ?? null)
        : field === 'q'
          ? (panel?.stockRemaining ?? null)
          : (panel?.dailyCreateLimit ?? null);
    const currentDisplay =
      currentNum === null ? t(ctx, 'unlimited') : localizedNumber(currentNum, ctx);
    const promptKey =
      field === 'm'
        ? 'admin_panel_capacity_prompt'
        : field === 'q'
          ? 'admin_panel_stock_prompt'
          : 'admin_panel_daily_limit_prompt';
    const titleKey =
      field === 'm'
        ? 'admin_panel_edit_capacity_button'
        : field === 'q'
          ? 'admin_panel_edit_stock_button'
          : 'admin_panel_edit_daily_limit_button';
    await startAdminInput(ctx, {
      kind: 'pnl:limit',
      payload: { panelId, field, currentDisplay },
      returnRoute: `adm:pnl:v:${panelId}`,
      promptText: buildAdminPromptScreen(
        '📊',
        t(ctx, titleKey),
        t(ctx, promptKey, { current: currentDisplay }),
        {
          breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_panels')),
        }
      ),
      keyboard: adminInputCancelKeyboard(ctx, (kb) => {
        kb.text(
          t(ctx, 'admin_panel_limit_unlimited_button'),
          panelCallback('eu', panelId, field)
        ).row();
      }),
    });
    return;
  }

  ctx.session.adminPanelAction = action;
  await ctx.conversation.enter('adminPanelConversation');
}

async function beginServiceLimitEdit(
  ctx: MenuContext,
  panelId: string,
  serviceId: number,
  field: LimitFieldCode
): Promise<void> {
  const panel = ctx.services?.panelRegistry.getPanel(panelId);
  const service = panel?.services.find((s) => s.serviceId === serviceId);
  await ctx.answerCallbackQuery();
  const currentNum =
    field === 'm'
      ? (service?.maxConfigs ?? null)
      : field === 'q'
        ? (service?.stockRemaining ?? null)
        : (service?.dailyCreateLimit ?? null);
  const currentDisplay =
    currentNum === null ? t(ctx, 'unlimited') : localizedNumber(currentNum, ctx);
  const promptKey =
    field === 'm'
      ? 'admin_panel_capacity_prompt'
      : field === 'q'
        ? 'admin_panel_stock_prompt'
        : 'admin_panel_daily_limit_prompt';
  const titleKey =
    field === 'm'
      ? 'admin_panel_edit_capacity_button'
      : field === 'q'
        ? 'admin_panel_edit_stock_button'
        : 'admin_panel_edit_daily_limit_button';
  await startAdminInput(ctx, {
    kind: 'pnl:limit',
    payload: { panelId, serviceId, field, currentDisplay },
    returnRoute: `adm:pnl:sd:${panelId}:${serviceId}`,
    promptText: buildAdminPromptScreen(
      '📊',
      t(ctx, titleKey),
      t(ctx, promptKey, { current: currentDisplay }),
      {
        breadcrumb: buildBreadcrumb(
          t(ctx, 'admin_home_title'),
          t(ctx, 'admin_nav_panels'),
          panel ? escapeTelegramMarkdown(panel.name) : undefined
        ),
      }
    ),
    keyboard: adminInputCancelKeyboard(ctx, (kb) => {
      kb.text(
        t(ctx, 'admin_panel_limit_unlimited_button'),
        panelCallback('su', panelId, serviceId, field)
      ).row();
    }),
  });
}

async function promptPanelDisable(ctx: MenuContext, panelId: string): Promise<void> {
  if (!ctx.services) return;
  const panel = ctx.services.panelRegistry.getPanel(panelId);
  if (!panel) {
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_not_found'), show_alert: true });
    return;
  }
  await ctx.answerCallbackQuery();
  await renderPanelScreen(
    ctx,
    buildAdminScreen({
      emoji: '⏸',
      title: t(ctx, 'admin_panel_disable_confirm_title'),
      breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_panels')),
      primary: {
        label: t(ctx, 'admin_panel_name_label'),
        value: escapeTelegramMarkdown(panel.name),
        inline: true,
      },
      footer: `⚠️ ${t(ctx, 'admin_panel_disable_confirm_body')}`,
    }),
    buildAdminConfirmKeyboard(ctx, {
      confirmCallback: `adm:pnl:dis_ok:${panelId}`,
      cancelCallback: panelCallback('v', panelId),
      confirmLabel: t(ctx, 'admin_panel_disable_confirm_button'),
    }),
    'Markdown'
  );
}

async function testPanelConnection(ctx: MenuContext, panelId: string): Promise<void> {
  if (!ctx.services) return;
  try {
    const result = await ctx.services.panelRegistry.testConnection(panelId);
    invalidatePanelHealthCache(ctx.services.panelRegistry);
    const alertText = result.ok
      ? t(ctx, 'admin_panel_test_toast_ok', { latency: localizedNumber(result.latencyMs, ctx) })
      : t(ctx, 'admin_panel_test_toast_failed');
    await ctx.answerCallbackQuery({ text: alertText, show_alert: !result.ok });
    await renderPanelDetail(ctx, panelId, { lastPingMs: result.latencyMs, isError: !result.ok });
  } catch {
    await ctx.answerCallbackQuery({
      text: t(ctx, 'admin_panel_test_toast_failed'),
      show_alert: true,
    });
    await renderPanelDetail(ctx, panelId, { isError: true });
  }
}

async function setPanelEnabled(ctx: MenuContext, panelId: string, enabled: boolean): Promise<void> {
  if (!ctx.services) return;
  try {
    await ctx.services.panelRegistry.setPanelEnabled(panelId, enabled);
    invalidatePanelHealthCache(ctx.services.panelRegistry);
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_saved') }).catch(() => {});
    await renderPanelDetail(ctx, panelId, {
      notice: { tone: 'success', text: t(ctx, 'admin_panel_saved') },
    });
  } catch {
    await ctx
      .answerCallbackQuery({ text: t(ctx, 'admin_panel_save_failed'), show_alert: true })
      .catch(() => {});
  }
}

async function setDefaultPanel(ctx: MenuContext, panelId: string): Promise<void> {
  if (!ctx.services) return;
  try {
    await ctx.services.panelRegistry.setDefaultPanel(panelId);
    invalidatePanelHealthCache(ctx.services.panelRegistry);
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_saved') });
    await renderPanelDetail(ctx, panelId, {
      notice: { tone: 'success', text: t(ctx, 'admin_panel_saved') },
    });
  } catch {
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_save_failed'), show_alert: true });
  }
}

async function updatePanelService(
  ctx: MenuContext,
  action: PanelServiceAction,
  panelId: string,
  serviceId: number
): Promise<void> {
  if (!ctx.services) return;
  if (!isValidServiceId(serviceId)) {
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_save_failed'), show_alert: true });
    return;
  }
  try {
    if (action === 'default') {
      await ctx.services.panelRegistry.setDefaultService(panelId, serviceId);
    } else if (action === 'toggle_enabled') {
      const currentPanel = ctx.services.panelRegistry.getPanel(panelId);
      const currentService = currentPanel?.services.find((s) => s.serviceId === serviceId);
      if (!currentService) throw new Error('SERVICE_NOT_FOUND');
      await ctx.services.panelRegistry.updateService(panelId, serviceId, {
        enabled: !currentService.enabled,
      });
    } else {
      await ctx.services.panelRegistry.resolveTarget(panelId, serviceId);
      await ctx.services.translationService.updateSettings({
        custom_volume_target_json: JSON.stringify({ panelId, serviceId }),
        custom_volume_panel_id: '',
        custom_volume_service_id: '',
      });
    }
    const savedMsg = t(
      ctx,
      action === 'custom' ? 'admin_panel_custom_target_saved' : 'admin_panel_saved'
    );
    await ctx.answerCallbackQuery({ text: savedMsg });
    await renderServiceDetail(ctx, panelId, serviceId, { tone: 'success', text: savedMsg });
  } catch {
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_update_failed'), show_alert: true });
  }
}

async function promptPanelServiceDeletion(
  ctx: MenuContext,
  panelId: string,
  serviceId: number
): Promise<void> {
  if (!ctx.services) return;
  if (!isValidServiceId(serviceId)) {
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_save_failed'), show_alert: true });
    return;
  }
  const panel = ctx.services.panelRegistry.getPanel(panelId);
  const service = panel?.services.find((item) => item.serviceId === serviceId);
  if (!service) {
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_not_found'), show_alert: true });
    return;
  }
  await ctx.answerCallbackQuery();
  await renderPanelScreen(
    ctx,
    buildAdminScreen({
      emoji: '⚠️',
      title: t(ctx, 'admin_panel_service_delete_title'),
      breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_panels')),
      subtitle: t(ctx, 'admin_panel_service_delete_subtitle'),
      primary: {
        label: t(ctx, 'admin_panel_services_section'),
        value: escapeTelegramMarkdown(service.name),
        inline: true,
      },
      footer: t(ctx, 'admin_panel_service_delete_consequence'),
    }),
    buildAdminConfirmKeyboard(ctx, {
      confirmCallback: panelCallback('ss', 'xc', panelId, serviceId),
      cancelCallback: panelCallback('sd', panelId, serviceId),
    }),
    'Markdown'
  );
}

async function deletePanelService(
  ctx: MenuContext,
  panelId: string,
  serviceId: number
): Promise<void> {
  if (!ctx.services) return;
  if (!isValidServiceId(serviceId)) {
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_save_failed'), show_alert: true });
    return;
  }
  try {
    await ctx.services.panelRegistry.deleteService(panelId, serviceId);
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_saved') });
    await renderPanelServicesMenu(ctx, panelId, 1, {
      tone: 'success',
      text: t(ctx, 'admin_panel_saved'),
    });
  } catch {
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_in_use'), show_alert: true });
  }
}

async function promptPanelDeletion(ctx: MenuContext, panelId: string): Promise<void> {
  if (!ctx.services) return;
  const panel = ctx.services.panelRegistry.getPanel(panelId);
  if (!panel) {
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_not_found'), show_alert: true });
    return;
  }
  if (ctx.services.panelRegistry.listPanels().length <= 1) {
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_last_delete'), show_alert: true });
    return;
  }
  await ctx.answerCallbackQuery();
  await renderPanelScreen(
    ctx,
    buildAdminScreen({
      emoji: '⚠️',
      title: t(ctx, 'admin_panel_delete_title'),
      breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_panels')),
      subtitle: t(ctx, 'admin_panel_delete_subtitle'),
      primary: {
        label: t(ctx, 'admin_panel_name_label'),
        value: escapeTelegramMarkdown(panel.name),
        inline: true,
      },
      footer: t(ctx, 'admin_panel_delete_consequence'),
    }),
    buildAdminConfirmKeyboard(ctx, {
      confirmCallback: panelCallback('xc', panelId),
      cancelCallback: panelCallback('v', panelId),
    }),
    'Markdown'
  );
}

async function deletePanel(ctx: MenuContext, panelId: string): Promise<void> {
  if (!ctx.services) return;
  try {
    await ctx.services.panelRegistry.deletePanel(panelId);
    invalidatePanelHealthCache(ctx.services.panelRegistry);
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_panel_deleted') });
    await renderPanelRegistry(ctx, 1, {
      tone: 'success',
      text: t(ctx, 'admin_panel_deleted'),
    });
  } catch (error) {
    await ctx.answerCallbackQuery({
      text: t(
        ctx,
        error instanceof RebeccaPanelInUseError ? 'admin_panel_in_use' : 'admin_panel_save_failed'
      ),
      show_alert: true,
    });
  }
}

function isValidServiceId(serviceId: number): boolean {
  return Number.isSafeInteger(serviceId) && serviceId > 0 && serviceId <= MAX_SERVICE_ID;
}

function clearPendingPanelSecret(ctx: MenuContext): void {
  ctx.session.adminPanelAction = undefined;
  ctx.session.adminPanelActionAt = undefined;
  ctx.session.adminPanelId = undefined;
  ctx.session.adminPanelDraft = undefined;
}

async function renderPanelScreen(
  ctx: MenuContext,
  text: string,
  keyboard: InlineKeyboard,
  parseMode: 'Markdown' | undefined = 'Markdown'
): Promise<void> {
  await renderScreen(ctx, text, {
    parse_mode: parseMode,
    reply_markup: keyboard,
  });
}
