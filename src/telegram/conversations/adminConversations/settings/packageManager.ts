import { InlineKeyboard } from 'grammy';
import type { PackageOption } from '../../../../domain/services/PricingService.js';
import type { PackageCategory } from '../../../../domain/services/PackageCategoryService.js';
import {
  generatePackageId,
  hasDuplicatePackageName,
  MAX_PACKAGE_COUNT,
  parsePackageOptionsJson,
} from '../../../../domain/services/PricingService.js';
export { generatePackageId };
import type { ConversationContext, MyConversation } from '../../../types.js';
import {
  formatPackageButtonLabel,
  localizedNumber,
  normalizeInputDigits,
  t,
  tm,
} from '../../../locale.js';
import { callbackData } from '../../../callbackData.js';
import { escapeTelegramMarkdown, sanitizeTelegramInlineCode } from '../../../rendering.js';
import {
  buildEmptyState,
  buildPromptScreen,
  buildScreen,
  promptInConversation,
  replyInAdminConversation,
} from '../../../ui.js';
import {
  buildPackageManagerScreen,
  buildSettingsPrompt,
  truncateButtonLabel,
} from './presentation.js';
import { renderSettingsScreen, waitForSettingsInput } from './navigation.js';
import { requireAdmin } from '../shared.js';
import { editSetting } from './conversation.js';
import { getSettingDefinition } from './catalog.js';
import { renderSalesMenu } from '../../../keyboards/adminMenu.js';

export type PackageManagerOutcome = 'back' | 'cancel';
type FieldResult<T> = { type: 'value'; value: T } | { type: 'back' } | { type: 'cancel' };
const PACKAGE_PAGE_SIZE = 8;

export async function adminManagePackagesConversation(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<void> {
  if (!(await requireAdmin(conversation, ctx))) return;
  const outcome = await managePackages(conversation, ctx);
  if (outcome === 'cancel') return;
  await conversation.external(async (outsideCtx) => {
    await renderSalesMenu(outsideCtx);
  });
}

export async function managePackages(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<PackageManagerOutcome> {
  if (!ctx.services) return 'cancel';
  let packages = await conversation.external((outsideCtx) =>
    currentPackages(outsideCtx?.services ? outsideCtx : ctx)
  );
  let page = 0;
  let activeCtx: ConversationContext = ctx;

  for (;;) {
    page = clampPackagePage(page, packages.length);
    const pageCount = packagePageCount(packages.length);
    const visiblePackages = packages.slice(
      page * PACKAGE_PAGE_SIZE,
      (page + 1) * PACKAGE_PAGE_SIZE
    );
    const meta = await conversation.external(async (outsideCtx) => {
      const services = outsideCtx?.services ?? activeCtx.services;
      const categories = (await services?.packageCategoryService?.listCategories(true)) ?? [];
      const displayMode =
        services?.translationService.getSetting('package_display_mode', 'specs') === 'name'
          ? ('name' as const)
          : ('specs' as const);
      return {
        categoryNamesById: new Map(
          categories.map((c) => [c.id, `${c.icon ? `${c.icon} ` : ''}${c.name}`])
        ),
        displayMode,
      };
    });

    const activeCount = packages.filter((pkg) => pkg.enabled !== false).length;
    const inactiveCount = packages.length - activeCount;
    const keyboard = buildPackageManagerKeyboard(activeCtx, packages, page);
    const screenText = buildPackageManagerScreen(activeCtx, visiblePackages, {
      totalCount: packages.length,
      activeCount,
      inactiveCount,
      categoryNamesById: meta.categoryNamesById,
      displayMode: meta.displayMode,
      page,
      totalPages: pageCount,
    });

    await renderSettingsScreen(conversation, activeCtx, screenText, keyboard);

    const input = await waitForSettingsInput(conversation, {
      callbackPrefixes: [
        'pkg-edit:',
        'pkg-del:',
        'pkg-page:',
        'pkg-add',
        'pkg-toggle:',
        'pkg-clone:',
        'pkg-up:',
        'pkg-down:',
        'pkg-categories',
        'pkg-settings',
      ],
      backCallbacks: ['pkg-back'],
      retryKeyboard: keyboard,
    });
    if (input.type === 'cancel') return 'cancel';
    if (input.type === 'back') return 'back';
    if (input.type !== 'callback') continue;

    activeCtx = input.ctx;

    if (input.data === 'pkg-categories') {
      const outcome = await manageCategories(conversation, activeCtx);
      if (outcome === 'cancel') return 'cancel';
      packages = await conversation.external((outsideCtx) =>
        currentPackages(outsideCtx?.services ? outsideCtx : activeCtx)
      );
      continue;
    }

    if (input.data === 'pkg-settings') {
      const outcome = await managePackagePolicies(conversation, activeCtx);
      if (outcome === 'cancel') return 'cancel';
      continue;
    }

    if (input.data.startsWith('pkg-page:')) {
      const requestedPage = parsePackageIndex(input.data, 'pkg-page:');
      if (requestedPage !== undefined && requestedPage < pageCount) page = requestedPage;
      continue;
    }

    if (input.data.startsWith('pkg-edit:')) {
      const pkgId = input.data.slice('pkg-edit:'.length);
      if (!packages.some((pkg) => pkg.id === pkgId)) continue;
      const detailOutcome = await manageSinglePackage(conversation, activeCtx, packages, pkgId);
      if (detailOutcome.type === 'cancel') return 'cancel';
      activeCtx = detailOutcome.activeCtx;
      packages = detailOutcome.packages;
      page = clampPackagePage(page, packages.length);
      continue;
    }

    let nextPackages: PackageOption[] | undefined;

    if (input.data.startsWith('pkg-toggle:')) {
      nextPackages = togglePackageEnabled(packages, input.data.slice('pkg-toggle:'.length));
    } else if (input.data.startsWith('pkg-clone:')) {
      const pkgId = input.data.slice('pkg-clone:'.length);
      const cloneOutcome = await buildClonedPackageList(conversation, activeCtx, packages, pkgId);
      if (cloneOutcome.type === 'cancel') return 'cancel';
      if (cloneOutcome.type === 'back') return 'back';
      if (cloneOutcome.type === 'limit') continue;
      nextPackages = cloneOutcome.packages;
    } else if (input.data.startsWith('pkg-up:')) {
      nextPackages = movePackage(packages, input.data.slice('pkg-up:'.length), -1);
    } else if (input.data.startsWith('pkg-down:')) {
      nextPackages = movePackage(packages, input.data.slice('pkg-down:'.length), 1);
    } else if (input.data === 'pkg-add') {
      if (packages.length >= MAX_PACKAGE_COUNT) {
        const action = await showPackageNotice(
          conversation,
          activeCtx,
          buildEmptyState(
            '⚠️',
            t(activeCtx, 'admin_package_manager_title'),
            t(activeCtx, 'admin_pkg_limit_reached', {
              count: localizedNumber(MAX_PACKAGE_COUNT, activeCtx),
            })
          )
        );
        if (action !== 'continue') return action;
        continue;
      }
      const created = await promptPackageFields(conversation, activeCtx, packages);
      if (created.type === 'cancel') return 'cancel';
      if (created.type === 'back') continue;
      if (hasDuplicatePackageName(packages, created.value.name)) {
        const action = await showPackageNotice(
          conversation,
          activeCtx,
          buildEmptyState(
            '⚠️',
            t(activeCtx, 'admin_package_manager_title'),
            t(activeCtx, 'admin_pkg_duplicate_name')
          )
        );
        if (action !== 'continue') return action;
        continue;
      }
      nextPackages = [...packages, created.value];
    } else if (input.data.startsWith('pkg-del:')) {
      const pkgId = input.data.slice('pkg-del:'.length);
      const deleteOutcome = await confirmAndDeletePackage(conversation, activeCtx, packages, pkgId);
      if (deleteOutcome.type === 'cancel') return 'cancel';
      if (deleteOutcome.type === 'back') return 'back';
      if (deleteOutcome.type === 'unchanged') continue;
      nextPackages = deleteOutcome.packages;
    }

    if (!nextPackages) continue;
    const saveResult = await persistPackages(conversation, activeCtx, nextPackages);
    if (saveResult.type === 'cancel') return 'cancel';
    if (saveResult.type === 'back') return 'back';
    if (saveResult.type === 'failed') continue;

    packages = nextPackages;
    page = clampPackagePage(page, packages.length);
  }
}

/**
 * Interactive single-package detail screen with single-field quick editing,
 * status toggle, reordering, cloning, and confirmed deletion.
 */
async function manageSinglePackage(
  conversation: MyConversation,
  initialCtx: ConversationContext,
  initialPackages: PackageOption[],
  initialPkgId: string
): Promise<
  { type: 'cancel' } | { type: 'done'; activeCtx: ConversationContext; packages: PackageOption[] }
> {
  let activeCtx = initialCtx;
  let packages = initialPackages;
  let activePkgId = initialPkgId;

  for (;;) {
    const index = packages.findIndex((pkg) => pkg.id === activePkgId);
    const existing = index === -1 ? undefined : packages[index];
    if (!existing || index === -1) {
      return { type: 'done', activeCtx, packages };
    }

    const resolvedLabels = await conversation.external(async (outsideCtx) => {
      const services = outsideCtx?.services ?? activeCtx.services;
      const category = existing.categoryId
        ? await services?.packageCategoryService?.getCategoryById(existing.categoryId)
        : undefined;
      const categoryLabel = category
        ? `${category.icon ? `${category.icon} ` : ''}${category.name}`
        : t(activeCtx, 'admin_pkg_no_category');

      let targetLabel = t(activeCtx, 'admin_pkg_default_target');
      if (existing.panelId && existing.serviceId) {
        const panel = services?.panelRegistry.getPanel(existing.panelId);
        const service = panel?.services.find((s) => s.serviceId === existing.serviceId);
        if (panel && service) {
          targetLabel = `${panel.name} / ${service.name}`;
        }
      }

      return { categoryLabel, targetLabel };
    });

    const screenText = buildPackageDetailScreen(activeCtx, existing, {
      index,
      total: packages.length,
      categoryLabel: resolvedLabels.categoryLabel,
      targetLabel: resolvedLabels.targetLabel,
    });
    const keyboard = buildPackageDetailKeyboard(activeCtx, existing, index, packages.length);

    await renderSettingsScreen(conversation, activeCtx, screenText, keyboard);

    const input = await waitForSettingsInput(conversation, {
      callbackPrefixes: ['pkg-q:', 'pkg-toggle:', 'pkg-clone:', 'pkg-up:', 'pkg-down:', 'pkg-del:'],
      backCallbacks: ['pkg-detail-back'],
      retryKeyboard: keyboard,
    });

    if (input.type === 'cancel') return { type: 'cancel' };
    if (input.type === 'back') return { type: 'done', activeCtx, packages };
    if (input.type !== 'callback') continue;

    activeCtx = input.ctx;
    let nextPackages: PackageOption[] | undefined;
    let nextActivePkgId = activePkgId;

    if (input.data.startsWith('pkg-q:n:')) {
      const nameResult = await askPackageString(
        conversation,
        activeCtx,
        'admin_pkg_name_prompt',
        existing.name,
        (val) => val.length >= 1 && val.length <= 120
      );
      if (nameResult.type === 'cancel') return { type: 'cancel' };
      if (nameResult.type !== 'value') continue;
      if (hasDuplicatePackageName(packages, nameResult.value, index)) {
        const action = await showPackageNotice(
          conversation,
          activeCtx,
          buildEmptyState(
            '⚠️',
            t(activeCtx, 'admin_package_manager_title'),
            t(activeCtx, 'admin_pkg_duplicate_name')
          )
        );
        if (action === 'cancel') return { type: 'cancel' };
        continue;
      }
      nextPackages = packages.map((pkg) =>
        pkg.id === activePkgId ? { ...pkg, name: nameResult.value } : pkg
      );
    } else if (input.data.startsWith('pkg-q:g:')) {
      const gbResult = await askPackageInteger(
        conversation,
        activeCtx,
        'admin_pkg_gb_prompt',
        existing.gbAmount,
        1,
        10_000
      );
      if (gbResult.type === 'cancel') return { type: 'cancel' };
      if (gbResult.type !== 'value') continue;
      nextPackages = packages.map((pkg) =>
        pkg.id === activePkgId ? { ...pkg, gbAmount: gbResult.value } : pkg
      );
    } else if (input.data.startsWith('pkg-q:d:')) {
      const daysResult = await askPackageInteger(
        conversation,
        activeCtx,
        'admin_pkg_days_prompt',
        existing.durationDays,
        1,
        3_650
      );
      if (daysResult.type === 'cancel') return { type: 'cancel' };
      if (daysResult.type !== 'value') continue;
      nextPackages = packages.map((pkg) =>
        pkg.id === activePkgId ? { ...pkg, durationDays: daysResult.value } : pkg
      );
    } else if (input.data.startsWith('pkg-q:p:')) {
      const priceResult = await askPackageInteger(
        conversation,
        activeCtx,
        'admin_pkg_price_prompt',
        existing.price,
        1,
        Number.MAX_SAFE_INTEGER
      );
      if (priceResult.type === 'cancel') return { type: 'cancel' };
      if (priceResult.type !== 'value') continue;
      nextPackages = packages.map((pkg) =>
        pkg.id === activePkgId ? { ...pkg, price: priceResult.value } : pkg
      );
    } else if (input.data.startsWith('pkg-q:c:')) {
      const categories = await conversation.external(
        async (outsideCtx) =>
          (await (
            outsideCtx?.services ?? activeCtx.services
          )?.packageCategoryService?.listCategories(true)) ?? []
      );
      if (categories.length === 0) {
        const action = await showPackageNotice(
          conversation,
          activeCtx,
          buildEmptyState(
            '🏷️',
            t(activeCtx, 'admin_category_manager_title'),
            t(activeCtx, 'admin_category_empty_hint')
          )
        );
        if (action === 'cancel') return { type: 'cancel' };
        continue;
      }
      const catResult = await choosePackageCategory(conversation, activeCtx, existing.categoryId);
      if (catResult.type === 'cancel') return { type: 'cancel' };
      if (catResult.type !== 'value') continue;
      nextPackages = packages.map((pkg) =>
        pkg.id === activePkgId ? { ...pkg, categoryId: catResult.value } : pkg
      );
    } else if (input.data.startsWith('pkg-q:t:')) {
      const targetResult = await choosePackageTarget(conversation, activeCtx, existing);
      if (targetResult.type === 'cancel') return { type: 'cancel' };
      if (targetResult.type !== 'value') continue;
      nextPackages = packages.map((pkg) =>
        pkg.id === activePkgId
          ? {
              ...pkg,
              panelId: targetResult.value.panelId,
              serviceId: targetResult.value.serviceId,
            }
          : pkg
      );
    } else if (input.data.startsWith('pkg-toggle:')) {
      nextPackages = togglePackageEnabled(packages, activePkgId);
    } else if (input.data.startsWith('pkg-up:')) {
      nextPackages = movePackage(packages, activePkgId, -1);
    } else if (input.data.startsWith('pkg-down:')) {
      nextPackages = movePackage(packages, activePkgId, 1);
    } else if (input.data.startsWith('pkg-clone:')) {
      const cloneOutcome = await buildClonedPackageList(
        conversation,
        activeCtx,
        packages,
        activePkgId
      );
      if (cloneOutcome.type === 'cancel') return { type: 'cancel' };
      if (cloneOutcome.type === 'back') return { type: 'done', activeCtx, packages };
      if (cloneOutcome.type === 'limit') continue;
      nextPackages = cloneOutcome.packages;
      nextActivePkgId = cloneOutcome.clonedId;
    } else if (input.data.startsWith('pkg-del:')) {
      const deleteOutcome = await confirmAndDeletePackage(
        conversation,
        activeCtx,
        packages,
        activePkgId
      );
      if (deleteOutcome.type === 'cancel') return { type: 'cancel' };
      if (deleteOutcome.type === 'back') return { type: 'done', activeCtx, packages };
      if (deleteOutcome.type === 'unchanged') continue;
      const saveResult = await persistPackages(conversation, activeCtx, deleteOutcome.packages);
      if (saveResult.type === 'cancel') return { type: 'cancel' };
      if (saveResult.type === 'failed') continue;
      return { type: 'done', activeCtx, packages: deleteOutcome.packages };
    }

    if (!nextPackages) continue;
    const saveResult = await persistPackages(conversation, activeCtx, nextPackages);
    if (saveResult.type === 'cancel') return { type: 'cancel' };
    if (saveResult.type === 'failed') continue;
    packages = nextPackages;
    activePkgId = nextActivePkgId;
  }
}

export function buildPackageDetailScreen(
  ctx: ConversationContext,
  pkg: PackageOption,
  meta: {
    index: number;
    total: number;
    categoryLabel: string;
    targetLabel: string;
  }
): string {
  const isEnabled = pkg.enabled !== false;
  const unitPrice = pkg.gbAmount > 0 ? Math.round(pkg.price / pkg.gbAmount) : pkg.price;

  return buildScreen({
    emoji: '📦',
    title: escapeTelegramMarkdown(pkg.name),
    subtitle: t(ctx, 'admin_pkg_detail_subtitle'),
    primary: {
      emoji: isEnabled ? '🟢' : '⚪️',
      label: t(ctx, 'admin_pkg_status_label'),
      value: isEnabled ? t(ctx, 'admin_pkg_active_badge') : t(ctx, 'admin_pkg_inactive_badge'),
    },
    sections: [
      {
        emoji: '📊',
        title: t(ctx, 'admin_pkg_specs_section'),
        fields: [
          {
            emoji: '💾',
            label: t(ctx, 'admin_pkg_gb_label'),
            value: `${localizedNumber(pkg.gbAmount, ctx)} ${t(ctx, 'traffic_unit_gb')}`,
          },
          {
            emoji: '⏳',
            label: t(ctx, 'admin_pkg_days_label'),
            value: `${localizedNumber(pkg.durationDays, ctx)} ${t(ctx, 'days_unit')}`,
          },
          {
            emoji: '💰',
            label: t(ctx, 'admin_pkg_price_label'),
            value: `${localizedNumber(pkg.price, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          {
            emoji: '📈',
            label: t(ctx, 'admin_pkg_unit_price_label'),
            value: `${localizedNumber(unitPrice, ctx)} ${t(ctx, 'currency_toman')}`,
          },
        ],
      },
      {
        emoji: '🧭',
        title: t(ctx, 'admin_pkg_routing_section'),
        fields: [
          {
            emoji: '🏷️',
            label: t(ctx, 'admin_pkg_category_label'),
            value: escapeTelegramMarkdown(meta.categoryLabel),
          },
          {
            emoji: '🎯',
            label: t(ctx, 'admin_pkg_target_label'),
            value: escapeTelegramMarkdown(meta.targetLabel),
          },
          {
            emoji: '🔢',
            label: t(ctx, 'admin_pkg_position_label'),
            value: t(ctx, 'admin_pkg_position_value', {
              index: localizedNumber(meta.index + 1, ctx),
              total: localizedNumber(meta.total, ctx),
            }),
          },
        ],
      },
    ],
    footer: `ℹ️ ${t(ctx, 'admin_home_hint')}`,
  });
}

export function buildPackageDetailKeyboard(
  ctx: ConversationContext,
  pkg: PackageOption,
  index: number,
  total: number
): InlineKeyboard {
  const isEnabled = pkg.enabled !== false;
  const keyboard = new InlineKeyboard()
    .text(t(ctx, 'admin_pkg_edit_name_btn'), callbackData('pkg-q:n', pkg.id))
    .text(t(ctx, 'admin_pkg_edit_gb_btn'), callbackData('pkg-q:g', pkg.id))
    .row()
    .text(t(ctx, 'admin_pkg_edit_days_btn'), callbackData('pkg-q:d', pkg.id))
    .text(t(ctx, 'admin_pkg_edit_price_btn'), callbackData('pkg-q:p', pkg.id))
    .row()
    .text(t(ctx, 'admin_pkg_edit_category_btn'), callbackData('pkg-q:c', pkg.id))
    .text(t(ctx, 'admin_pkg_edit_target_btn'), callbackData('pkg-q:t', pkg.id))
    .row()
    .text(
      isEnabled ? t(ctx, 'admin_pkg_disable_btn') : t(ctx, 'admin_pkg_enable_btn'),
      callbackData('pkg-toggle', pkg.id)
    )
    .text(t(ctx, 'admin_pkg_clone_btn'), callbackData('pkg-clone', pkg.id))
    .row();

  const hasUp = index > 0;
  const hasDown = index < total - 1;
  if (hasUp || hasDown) {
    if (hasUp) {
      keyboard.text(t(ctx, 'admin_pkg_move_up_btn'), callbackData('pkg-up', pkg.id));
    }
    if (hasDown) {
      keyboard.text(t(ctx, 'admin_pkg_move_down_btn'), callbackData('pkg-down', pkg.id));
    }
    keyboard.row();
  }

  keyboard
    .text(t(ctx, 'admin_pkg_delete_btn'), callbackData('pkg-del', pkg.id))
    .row()
    .text(t(ctx, 'admin_pkg_detail_back_btn'), 'pkg-detail-back');

  return keyboard;
}

export function buildPackageManagerKeyboard(
  ctx: ConversationContext,
  packages: readonly PackageOption[],
  page = 0
): InlineKeyboard {
  const safePage = clampPackagePage(page, packages.length);
  const pageCount = packagePageCount(packages.length);
  const visible = packages.slice(safePage * PACKAGE_PAGE_SIZE, (safePage + 1) * PACKAGE_PAGE_SIZE);
  const keyboard = new InlineKeyboard();

  for (const pkg of visible) {
    const isEnabled = pkg.enabled !== false;
    const statusIcon = isEnabled ? '🟢' : '⚪️';
    const buttonText = truncateButtonLabel(
      `${statusIcon} ${pkg.name} · ${localizedNumber(pkg.gbAmount, ctx)} ${t(ctx, 'traffic_unit_gb')} · ${localizedNumber(pkg.durationDays, ctx)} ${t(ctx, 'days_unit')} · ${localizedNumber(pkg.price, ctx)}`
    );
    keyboard.text(buttonText, callbackData('pkg-edit', pkg.id)).row();
  }

  if (pageCount > 1) {
    if (safePage > 0) keyboard.text(`⬅️ ${t(ctx, 'previous')}`, `pkg-page:${safePage - 1}`);
    keyboard.text(
      `${localizedNumber(safePage + 1, ctx)}/${localizedNumber(pageCount, ctx)}`,
      `pkg-page:${safePage}`
    );
    if (safePage < pageCount - 1) {
      keyboard.text(`${t(ctx, 'next')} ➡️`, `pkg-page:${safePage + 1}`);
    }
    keyboard.row();
  }

  keyboard
    .text(t(ctx, 'admin_pkg_add'), 'pkg-add')
    .text(t(ctx, 'admin_pkg_categories_button'), 'pkg-categories')
    .row()
    .text(t(ctx, 'admin_pkg_settings_btn'), 'pkg-settings')
    .row()
    .text(t(ctx, 'admin_menu_back_to_sales'), 'pkg-back');

  return keyboard;
}

function togglePackageEnabled(
  packages: readonly PackageOption[],
  pkgId: string
): PackageOption[] | undefined {
  const existing = packages.find((pkg) => pkg.id === pkgId);
  if (!existing) return undefined;
  const currentEnabled = existing.enabled !== false;
  return packages.map((pkg) => (pkg.id === pkgId ? { ...pkg, enabled: !currentEnabled } : pkg));
}

function movePackage(
  packages: readonly PackageOption[],
  pkgId: string,
  delta: -1 | 1
): PackageOption[] | undefined {
  const index = packages.findIndex((pkg) => pkg.id === pkgId);
  const targetIndex = index + delta;
  if (index < 0 || targetIndex < 0 || targetIndex >= packages.length) return undefined;
  const reordered = [...packages];
  const current = reordered[index]!;
  const neighbor = reordered[targetIndex]!;
  reordered[targetIndex] = current;
  reordered[index] = neighbor;
  return reordered;
}

async function buildClonedPackageList(
  conversation: MyConversation,
  activeCtx: ConversationContext,
  packages: readonly PackageOption[],
  pkgId: string
): Promise<
  | { type: 'cancel' }
  | { type: 'back' }
  | { type: 'limit' }
  | { type: 'ok'; packages: PackageOption[]; clonedId: string }
> {
  const index = packages.findIndex((pkg) => pkg.id === pkgId);
  const existing = index === -1 ? undefined : packages[index];
  if (!existing || index === -1) return { type: 'limit' };
  if (packages.length >= MAX_PACKAGE_COUNT) {
    const action = await showPackageNotice(
      conversation,
      activeCtx,
      buildEmptyState(
        '⚠️',
        t(activeCtx, 'admin_package_manager_title'),
        t(activeCtx, 'admin_pkg_limit_reached', {
          count: localizedNumber(MAX_PACKAGE_COUNT, activeCtx),
        })
      )
    );
    if (action === 'cancel') return { type: 'cancel' };
    if (action === 'back') return { type: 'back' };
    return { type: 'limit' };
  }
  const cloneSuffix = t(activeCtx, 'admin_pkg_copy_suffix');
  const maxBaseChars = Math.max(1, 120 - [...cloneSuffix].length - 1);
  const cloneName = `${[...existing.name].slice(0, maxBaseChars).join('')} ${cloneSuffix}`.trim();
  const cloneId = generatePackageId(cloneName, packages);
  const clonedPkg: PackageOption = {
    ...existing,
    id: cloneId,
    name: cloneName,
    enabled: existing.enabled ?? true,
  };
  return {
    type: 'ok',
    packages: [...packages.slice(0, index + 1), clonedPkg, ...packages.slice(index + 1)],
    clonedId: cloneId,
  };
}

async function confirmAndDeletePackage(
  conversation: MyConversation,
  activeCtx: ConversationContext,
  packages: readonly PackageOption[],
  pkgId: string
): Promise<
  | { type: 'cancel' }
  | { type: 'back' }
  | { type: 'unchanged' }
  | { type: 'deleted'; packages: PackageOption[] }
> {
  const existing = packages.find((pkg) => pkg.id === pkgId);
  if (!existing) return { type: 'unchanged' };
  if (packages.length <= 1) {
    const action = await showPackageNotice(
      conversation,
      activeCtx,
      buildEmptyState(
        '⚠️',
        t(activeCtx, 'admin_package_manager_title'),
        t(activeCtx, 'admin_pkg_last_removed')
      )
    );
    if (action === 'cancel') return { type: 'cancel' };
    if (action === 'back') return { type: 'back' };
    return { type: 'unchanged' };
  }
  const confirmKeyboard = new InlineKeyboard()
    .text(t(activeCtx, 'admin_confirm_button'), callbackData('pkg-del-confirm', pkgId))
    .row()
    .text(t(activeCtx, 'menu_cancel'), 'pkg-del-cancel');
  await promptInConversation(
    conversation,
    activeCtx,
    buildScreen({
      emoji: '⚠️',
      title: t(activeCtx, 'admin_package_manager_title'),
      primary: {
        emoji: '📦',
        label: t(activeCtx, 'checkout_package_section'),
        value: escapeTelegramMarkdown(existing.name),
      },
      footer: t(activeCtx, 'admin_pkg_delete_confirm', {
        name: escapeTelegramMarkdown(existing.name),
      }),
    }),
    { parse_mode: 'Markdown', reply_markup: confirmKeyboard }
  );
  const confirmation = await waitForSettingsInput(conversation, {
    callbackPrefixes: ['pkg-del-confirm:'],
    backCallbacks: ['pkg-del-cancel'],
    retryKeyboard: confirmKeyboard,
  });
  if (confirmation.type === 'cancel') return { type: 'cancel' };
  if (
    confirmation.type !== 'callback' ||
    confirmation.data !== callbackData('pkg-del-confirm', pkgId)
  ) {
    return { type: 'unchanged' };
  }
  return { type: 'deleted', packages: packages.filter((pkg) => pkg.id !== pkgId) };
}

async function persistPackages(
  conversation: MyConversation,
  activeCtx: ConversationContext,
  nextPackages: PackageOption[]
): Promise<{ type: 'ok' | 'failed' | 'back' | 'cancel' }> {
  try {
    await conversation.external(async (outsideCtx) => {
      if (!outsideCtx.services) throw new Error('SETTINGS_SERVICES_UNAVAILABLE');
      await outsideCtx.services.translationService.updateSetting(
        'packages_json',
        JSON.stringify(nextPackages)
      );
    });
    return { type: 'ok' };
  } catch {
    const action = await showPackageNotice(
      conversation,
      activeCtx,
      buildEmptyState(
        '⚠️',
        t(activeCtx, 'admin_package_manager_title'),
        t(activeCtx, 'admin_setting_save_failed')
      )
    );
    if (action === 'cancel') return { type: 'cancel' };
    if (action === 'back') return { type: 'back' };
    return { type: 'failed' };
  }
}

async function promptPackageFields(
  conversation: MyConversation,
  ctx: ConversationContext,
  packages: readonly PackageOption[],
  existing?: PackageOption
): Promise<FieldResult<PackageOption>> {
  const categories = await conversation.external(
    async (outsideCtx) =>
      (await (outsideCtx?.services ?? ctx.services)?.packageCategoryService?.listCategories(
        true
      )) ?? []
  );
  const totalSteps = categories.length > 0 ? 6 : 5;
  const wizardSubtitle = (step: number) =>
    t(ctx, 'admin_pkg_wizard_step', {
      step: localizedNumber(step, ctx),
      total: localizedNumber(totalSteps, ctx),
    });

  const name = await askPackageString(
    conversation,
    ctx,
    'admin_pkg_name_prompt',
    existing?.name,
    (value) => value.length >= 1 && value.length <= 120,
    wizardSubtitle(1)
  );
  if (name.type !== 'value') return name;

  const gbAmount = await askPackageInteger(
    conversation,
    ctx,
    'admin_pkg_gb_prompt',
    existing?.gbAmount,
    1,
    10_000,
    wizardSubtitle(2)
  );
  if (gbAmount.type !== 'value') return gbAmount;

  const durationDays = await askPackageInteger(
    conversation,
    ctx,
    'admin_pkg_days_prompt',
    existing?.durationDays,
    1,
    3_650,
    wizardSubtitle(3)
  );
  if (durationDays.type !== 'value') return durationDays;

  const price = await askPackageInteger(
    conversation,
    ctx,
    'admin_pkg_price_prompt',
    existing?.price,
    1,
    Number.MAX_SAFE_INTEGER,
    wizardSubtitle(4)
  );
  if (price.type !== 'value') return price;

  let categoryId: string | undefined = existing?.categoryId;
  if (categories.length > 0) {
    const categoryResult = await choosePackageCategory(
      conversation,
      ctx,
      existing?.categoryId,
      wizardSubtitle(5)
    );
    if (categoryResult.type !== 'value') return categoryResult;
    categoryId = categoryResult.value;
  }

  const target = await choosePackageTarget(conversation, ctx, existing, wizardSubtitle(totalSteps));
  if (target.type !== 'value') return target;

  return {
    type: 'value',
    value: {
      id: existing?.id ?? generatePackageId(name.value, packages),
      name: name.value,
      gbAmount: gbAmount.value,
      durationDays: durationDays.value,
      price: price.value,
      enabled: existing?.enabled ?? true,
      panelId: target.value.panelId,
      serviceId: target.value.serviceId,
      categoryId,
    },
  };
}

async function choosePackageCategory(
  conversation: MyConversation,
  ctx: ConversationContext,
  existingCategoryId?: string,
  subtitle?: string
): Promise<FieldResult<string | undefined>> {
  const categories = await conversation.external(
    async (outsideCtx) =>
      (await (outsideCtx?.services ?? ctx.services)?.packageCategoryService?.listCategories(
        true
      )) ?? []
  );
  if (categories.length === 0) {
    return { type: 'value', value: undefined };
  }

  const keyboard = new InlineKeyboard();
  keyboard
    .text(`${!existingCategoryId ? '✅ ' : ''}${t(ctx, 'admin_pkg_no_category')}`, 'pkg-cat:none')
    .row();

  for (const cat of categories) {
    const isSelected = existingCategoryId === cat.id;
    const label = truncateButtonLabel(
      `${isSelected ? '✅ ' : ''}${cat.icon ? `${cat.icon} ` : ''}${cat.name}`
    );
    keyboard.text(label, callbackData('pkg-cat', cat.id)).row();
  }

  keyboard.text(t(ctx, 'admin_pkg_cancel_edit'), 'pkg-field-back');

  await promptInConversation(
    conversation,
    ctx,
    subtitle
      ? buildPromptScreen(
          '🏷️',
          t(ctx, 'admin_pkg_category_label'),
          t(ctx, 'admin_pkg_select_category_prompt'),
          subtitle
        )
      : buildSettingsPrompt(ctx, t(ctx, 'admin_pkg_select_category_prompt'), { emoji: '🏷️' }),
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );

  const input = await waitForSettingsInput(conversation, {
    callbackPrefixes: ['pkg-cat:'],
    backCallbacks: ['pkg-field-back'],
    retryKeyboard: keyboard,
  });

  if (input.type === 'cancel') return { type: 'cancel' };
  if (input.type === 'back' || input.type !== 'callback') return { type: 'back' };

  const rawId = input.data.slice('pkg-cat:'.length);
  return { type: 'value', value: rawId === 'none' ? undefined : rawId };
}

async function choosePackageTarget(
  conversation: MyConversation,
  ctx: ConversationContext,
  existing?: PackageOption,
  subtitle?: string
): Promise<FieldResult<{ panelId: string; serviceId: number }>> {
  const panels = await conversation.external((outsideCtx) =>
    (outsideCtx?.services ?? ctx.services)?.panelRegistry
      .listPanels()
      .filter((panel) => panel.enabled && panel.services.length > 0)
  );
  if (!panels?.length) {
    await replyInAdminConversation(
      conversation,
      ctx,
      buildEmptyState(
        '⚠️',
        t(ctx, 'admin_package_manager_title'),
        t(ctx, 'admin_panel_required_first')
      ),
      { parse_mode: 'Markdown' }
    );
    return { type: 'back' };
  }
  const keyboard = new InlineKeyboard();
  for (const panel of panels) {
    for (const service of panel.services) {
      const selected = panel.id === existing?.panelId && service.serviceId === existing.serviceId;
      const label = truncateButtonLabel(`${selected ? '✅ ' : ''}${panel.name} / ${service.name}`);
      keyboard.text(label, callbackData('pkg-target', `${panel.id}:${service.serviceId}`)).row();
    }
  }
  keyboard.text(t(ctx, 'admin_pkg_cancel_edit'), 'pkg-field-back');
  await promptInConversation(
    conversation,
    ctx,
    subtitle
      ? buildPromptScreen(
          '🎯',
          t(ctx, 'admin_pkg_target_label'),
          t(ctx, 'admin_pkg_target_prompt'),
          subtitle
        )
      : buildSettingsPrompt(ctx, t(ctx, 'admin_pkg_target_prompt'), { emoji: '🎯' }),
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
  const input = await waitForSettingsInput(conversation, {
    callbackPrefixes: ['pkg-target:'],
    backCallbacks: ['pkg-field-back'],
    retryKeyboard: keyboard,
  });
  if (input.type === 'cancel') return { type: 'cancel' };
  if (input.type !== 'callback') return { type: 'back' };
  const rawTarget = input.data.slice('pkg-target:'.length);
  const [panelId, rawServiceId] = rawTarget.split(':');
  const serviceId = Number(rawServiceId);
  if (!panelId || !Number.isSafeInteger(serviceId) || serviceId <= 0) {
    return { type: 'back' };
  }
  const matchedPanel = panels.find((panel) => panel.id === panelId);
  const matchedService = matchedPanel?.services.find((service) => service.serviceId === serviceId);
  if (!matchedPanel || !matchedService) {
    return { type: 'back' };
  }
  return { type: 'value', value: { panelId, serviceId } };
}

async function askPackageString(
  conversation: MyConversation,
  ctx: ConversationContext,
  promptKey: string,
  existingValue: string | undefined,
  validate: (value: string) => boolean,
  subtitle?: string
): Promise<FieldResult<string>> {
  const keyboard = packageFieldKeyboard(ctx);
  const body = tm(
    ctx,
    promptKey,
    {
      current: escapeTelegramMarkdown(existingValue ?? '—'),
    },
    ['current']
  );
  const prompt = subtitle
    ? buildPromptScreen('📦', t(ctx, 'admin_package_manager_title'), body, subtitle)
    : body;

  for (;;) {
    await promptInConversation(conversation, ctx, prompt, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
    const input = await waitForSettingsInput(conversation, {
      allowText: true,
      backCallbacks: ['pkg-field-back'],
      retryKeyboard: keyboard,
    });
    if (input.type === 'cancel') return { type: 'cancel' };
    if (input.type !== 'text') return { type: 'back' };
    const value = input.value.trim();
    if (validate(value)) return { type: 'value', value };
    await promptInConversation(
      conversation,
      ctx,
      buildEmptyState(
        '⚠️',
        t(ctx, 'admin_package_manager_title'),
        t(ctx, 'admin_setting_text_invalid')
      ),
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
  }
}

async function askPackageInteger(
  conversation: MyConversation,
  ctx: ConversationContext,
  promptKey: string,
  existingValue: number | undefined,
  minimum: number,
  maximum: number,
  subtitle?: string
): Promise<FieldResult<number>> {
  const keyboard = packageFieldKeyboard(ctx);
  const body = tm(
    ctx,
    promptKey,
    {
      current: existingValue !== undefined ? localizedNumber(existingValue, ctx) : '—',
      min: localizedNumber(minimum, ctx),
      max: localizedNumber(maximum, ctx),
    },
    ['current', 'min', 'max']
  );
  const prompt = subtitle
    ? buildPromptScreen('📦', t(ctx, 'admin_package_manager_title'), body, subtitle)
    : body;

  for (;;) {
    await promptInConversation(conversation, ctx, prompt, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
    const input = await waitForSettingsInput(conversation, {
      allowText: true,
      backCallbacks: ['pkg-field-back'],
      retryKeyboard: keyboard,
    });
    if (input.type === 'cancel') return { type: 'cancel' };
    if (input.type !== 'text') return { type: 'back' };
    const normalized = normalizeInputDigits(input.value);
    const value = /^\d+$/u.test(normalized) ? Number(normalized) : Number.NaN;
    if (Number.isSafeInteger(value) && value >= minimum && value <= maximum) {
      return { type: 'value', value };
    }
    await promptInConversation(
      conversation,
      ctx,
      buildEmptyState(
        '⚠️',
        t(ctx, 'admin_package_manager_title'),
        t(ctx, 'admin_setting_number_range_invalid', {
          min: localizedNumber(minimum, ctx),
          max: localizedNumber(maximum, ctx),
        })
      ),
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
  }
}

async function showPackageNotice(
  conversation: MyConversation,
  ctx: ConversationContext,
  text: string
): Promise<'continue' | PackageManagerOutcome> {
  const keyboard = new InlineKeyboard()
    .text(t(ctx, 'admin_pkg_continue_editing'), 'pkg-continue')
    .row()
    .text(t(ctx, 'admin_menu_back_to_packages'), 'pkg-back');
  await promptInConversation(conversation, ctx, text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
  const input = await waitForSettingsInput(conversation, {
    callbackPrefixes: ['pkg-continue'],
    backCallbacks: ['pkg-back'],
    retryKeyboard: keyboard,
  });
  if (input.type === 'cancel') return 'cancel';
  if (input.type === 'back') return 'back';
  return 'continue';
}

function packageFieldKeyboard(ctx: ConversationContext): InlineKeyboard {
  return new InlineKeyboard().text(t(ctx, 'admin_pkg_cancel_edit'), 'pkg-field-back');
}

function currentPackages(ctx: ConversationContext): PackageOption[] {
  if (!ctx.services) return [];
  const packages = parsePackageOptionsJson(
    ctx.services.translationService.getSetting('packages_json')
  );
  return (packages ?? ctx.services.pricingService.getPackages()).map((pkg) => ({ ...pkg }));
}

function parsePackageIndex(data: string, prefix: string): number | undefined {
  const raw = data.slice(prefix.length);
  if (!/^\d+$/u.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function packagePageCount(packageCount: number): number {
  return Math.max(1, Math.ceil(packageCount / PACKAGE_PAGE_SIZE));
}

function clampPackagePage(page: number, packageCount: number): number {
  return Math.min(Math.max(0, page), packagePageCount(packageCount) - 1);
}

// ── Categories Management Subflow ──────────────────────────────────────────

async function manageCategories(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<PackageManagerOutcome> {
  if (!ctx.services) return 'cancel';

  let activeCtx = ctx;

  for (;;) {
    const [categories, pkgList] = await conversation.external(async (outsideCtx) => {
      const services = outsideCtx?.services ?? activeCtx.services;
      const list = (await services?.packageCategoryService?.listCategories(true)) ?? [];
      const pkgs = currentPackages(outsideCtx?.services ? outsideCtx : activeCtx);
      return [list, pkgs] as const;
    });

    const countByCategoryId = new Map<string, number>();
    for (const pkg of pkgList) {
      if (!pkg.categoryId) continue;
      countByCategoryId.set(pkg.categoryId, (countByCategoryId.get(pkg.categoryId) ?? 0) + 1);
    }

    const keyboard = new InlineKeyboard();
    for (const cat of categories) {
      const statusIcon = cat.enabled ? '🟢' : '⚪️';
      const count = countByCategoryId.get(cat.id) ?? 0;
      const countBadge = t(activeCtx, 'admin_category_count_badge', {
        count: localizedNumber(count, activeCtx),
      });
      const label = truncateButtonLabel(
        `${statusIcon} ${cat.icon ? `${cat.icon} ` : ''}${cat.name} · ${countBadge}`
      );
      keyboard.text(label, callbackData('cat:edit', cat.id)).row();
    }

    keyboard
      .text(t(activeCtx, 'admin_category_add_button'), 'cat:add')
      .row()
      .text(t(activeCtx, 'admin_menu_back_to_packages'), 'cat:back');

    const screenText =
      categories.length === 0
        ? buildEmptyState(
            '🏷️',
            t(activeCtx, 'admin_category_manager_title'),
            t(activeCtx, 'admin_category_empty_hint')
          )
        : buildScreen({
            emoji: '🏷️',
            title: t(activeCtx, 'admin_category_manager_title'),
            subtitle: t(activeCtx, 'admin_category_manager_subtitle'),
            sections: [
              {
                emoji: '📂',
                title: t(activeCtx, 'admin_pkg_categories_button'),
                fields: categories.map((cat) => {
                  const statusIcon = cat.enabled ? '🟢 ' : '⚪️ ';
                  const count = countByCategoryId.get(cat.id) ?? 0;
                  return {
                    label: `${statusIcon}${cat.icon ? `${cat.icon} ` : ''}${escapeTelegramMarkdown(cat.name)}`,
                    value: t(activeCtx, 'admin_category_count_badge', {
                      count: localizedNumber(count, activeCtx),
                    }),
                  };
                }),
              },
            ],
            footer: `ℹ️ ${t(activeCtx, 'admin_home_hint')}`,
          });

    await renderSettingsScreen(conversation, activeCtx, screenText, keyboard);

    const input = await waitForSettingsInput(conversation, {
      callbackPrefixes: ['cat:edit:', 'cat:up:', 'cat:down:', 'cat:del:', 'cat:add'],
      backCallbacks: ['cat:back'],
      retryKeyboard: keyboard,
    });

    if (input.type === 'cancel') return 'cancel';
    if (input.type === 'back') return 'back';
    if (input.type !== 'callback') continue;
    activeCtx = input.ctx;

    if (input.data === 'cat:add') {
      const nameResult = await askPackageString(
        conversation,
        activeCtx,
        'admin_category_name_prompt',
        undefined,
        (val) => val.length >= 1 && val.length <= 100
      );
      if (nameResult.type === 'cancel') return 'cancel';
      if (nameResult.type !== 'value') continue;

      const iconResult = await askPackageString(
        conversation,
        activeCtx,
        'admin_category_icon_prompt',
        undefined,
        () => true
      );
      if (iconResult.type === 'cancel') return 'cancel';
      const icon =
        iconResult.type === 'value' && iconResult.value !== '-' ? iconResult.value : undefined;

      await conversation.external(async (outsideCtx) => {
        if (!outsideCtx.services) return;
        await outsideCtx.services.packageCategoryService.createCategory({
          name: nameResult.value,
          icon,
        });
      });
      continue;
    }

    if (input.data.startsWith('cat:edit:')) {
      const catId = input.data.slice('cat:edit:'.length);
      const outcome = await manageSingleCategory(conversation, activeCtx, catId);
      if (outcome === 'cancel') return 'cancel';
      continue;
    }

    if (input.data.startsWith('cat:up:') || input.data.startsWith('cat:down:')) {
      await reorderSingleCategory(conversation, activeCtx, categories, input.data);
      continue;
    }

    if (input.data.startsWith('cat:del:')) {
      const catId = input.data.slice('cat:del:'.length);
      const delOutcome = await confirmAndDeleteCategory(conversation, activeCtx, catId);
      if (delOutcome === 'cancel') return 'cancel';
    }
  }
}

async function manageSingleCategory(
  conversation: MyConversation,
  initialCtx: ConversationContext,
  catId: string
): Promise<'done' | 'cancel'> {
  let activeCtx = initialCtx;

  for (;;) {
    const state = await conversation.external(async (outsideCtx) => {
      const services = outsideCtx?.services ?? activeCtx.services;
      const list = (await services?.packageCategoryService?.listCategories(true)) ?? [];
      const pkgs = currentPackages(outsideCtx?.services ? outsideCtx : activeCtx);
      const index = list.findIndex((c) => c.id === catId);
      return {
        categories: list,
        existing: index === -1 ? undefined : list[index],
        index,
        linkedCount: pkgs.filter((p) => p.categoryId === catId).length,
      };
    });

    const existing = state.existing;
    if (!existing || state.index === -1) return 'done';

    const editMenu = new InlineKeyboard()
      .text(t(activeCtx, 'admin_category_edit_name_btn'), callbackData('cat:edit-name', catId))
      .text(t(activeCtx, 'admin_category_edit_icon_btn'), callbackData('cat:edit-icon', catId))
      .row()
      .text(t(activeCtx, 'admin_category_edit_desc_btn'), callbackData('cat:edit-desc', catId))
      .text(
        existing.enabled
          ? t(activeCtx, 'admin_pkg_disable_btn')
          : t(activeCtx, 'admin_pkg_enable_btn'),
        callbackData('cat:toggle', catId)
      )
      .row();

    const hasUp = state.index > 0;
    const hasDown = state.index < state.categories.length - 1;
    if (hasUp || hasDown) {
      if (hasUp) {
        editMenu.text(t(activeCtx, 'admin_pkg_move_up_btn'), callbackData('cat:up', catId));
      }
      if (hasDown) {
        editMenu.text(t(activeCtx, 'admin_pkg_move_down_btn'), callbackData('cat:down', catId));
      }
      editMenu.row();
    }

    editMenu
      .text(t(activeCtx, 'admin_category_delete_btn'), callbackData('cat:del', catId))
      .row()
      .text(t(activeCtx, 'admin_menu_back_to_categories'), 'cat:edit-back');

    const detailText = buildScreen({
      emoji: existing.icon || '🏷️',
      title: escapeTelegramMarkdown(existing.name),
      subtitle: t(activeCtx, 'admin_category_detail_subtitle'),
      primary: {
        emoji: existing.enabled ? '🟢' : '⚪️',
        label: t(activeCtx, 'admin_pkg_status_label'),
        value: existing.enabled
          ? t(activeCtx, 'admin_pkg_active_badge')
          : t(activeCtx, 'admin_pkg_inactive_badge'),
      },
      sections: [
        {
          emoji: '🏷️',
          title: t(activeCtx, 'admin_pkg_category_label'),
          fields: [
            {
              emoji: '🎨',
              label: t(activeCtx, 'admin_category_icon_label'),
              value: existing.icon ? escapeTelegramMarkdown(existing.icon) : '—',
            },
            {
              emoji: '📝',
              label: t(activeCtx, 'admin_category_desc_label'),
              value: existing.description ? escapeTelegramMarkdown(existing.description) : '—',
            },
            {
              emoji: '📦',
              label: t(activeCtx, 'admin_category_packages_count_label'),
              value: t(activeCtx, 'admin_category_count_badge', {
                count: localizedNumber(state.linkedCount, activeCtx),
              }),
            },
            {
              emoji: '🔢',
              label: t(activeCtx, 'admin_pkg_position_label'),
              value: t(activeCtx, 'admin_pkg_position_value', {
                index: localizedNumber(state.index + 1, activeCtx),
                total: localizedNumber(state.categories.length, activeCtx),
              }),
            },
          ],
        },
      ],
      footer: `ℹ️ ${t(activeCtx, 'admin_home_hint')}`,
    });

    await renderSettingsScreen(conversation, activeCtx, detailText, editMenu);

    const editChoice = await waitForSettingsInput(conversation, {
      callbackPrefixes: [
        'cat:edit-name:',
        'cat:edit-icon:',
        'cat:edit-desc:',
        'cat:toggle:',
        'cat:up:',
        'cat:down:',
        'cat:del:',
      ],
      backCallbacks: ['cat:edit-back'],
      retryKeyboard: editMenu,
    });

    if (editChoice.type === 'cancel') return 'cancel';
    if (editChoice.type === 'back') return 'done';
    if (editChoice.type !== 'callback') continue;
    activeCtx = editChoice.ctx;

    if (editChoice.data.startsWith('cat:toggle:')) {
      await conversation.external(async (outsideCtx) => {
        if (!outsideCtx.services) return;
        await outsideCtx.services.packageCategoryService.updateCategory(catId, {
          enabled: !existing.enabled,
        });
      });
    } else if (editChoice.data.startsWith('cat:edit-name:')) {
      const newName = await askPackageString(
        conversation,
        activeCtx,
        'admin_category_name_prompt',
        existing.name,
        (val) => val.length >= 1 && val.length <= 100
      );
      if (newName.type === 'cancel') return 'cancel';
      if (newName.type === 'value') {
        await conversation.external(async (outsideCtx) => {
          if (!outsideCtx.services) return;
          await outsideCtx.services.packageCategoryService.updateCategory(catId, {
            name: newName.value,
          });
        });
      }
    } else if (editChoice.data.startsWith('cat:edit-icon:')) {
      const newIcon = await askPackageString(
        conversation,
        activeCtx,
        'admin_category_icon_prompt',
        existing.icon ?? undefined,
        () => true
      );
      if (newIcon.type === 'cancel') return 'cancel';
      if (newIcon.type === 'value') {
        await conversation.external(async (outsideCtx) => {
          if (!outsideCtx.services) return;
          await outsideCtx.services.packageCategoryService.updateCategory(catId, {
            icon: newIcon.value !== '-' ? newIcon.value : '',
          });
        });
      }
    } else if (editChoice.data.startsWith('cat:edit-desc:')) {
      const newDesc = await askPackageString(
        conversation,
        activeCtx,
        'admin_category_desc_prompt',
        existing.description ?? undefined,
        (val) => val.length <= 240
      );
      if (newDesc.type === 'cancel') return 'cancel';
      if (newDesc.type === 'value') {
        await conversation.external(async (outsideCtx) => {
          if (!outsideCtx.services) return;
          await outsideCtx.services.packageCategoryService.updateCategory(catId, {
            description: newDesc.value !== '-' ? newDesc.value : '',
          });
        });
      }
    } else if (editChoice.data.startsWith('cat:up:') || editChoice.data.startsWith('cat:down:')) {
      await reorderSingleCategory(conversation, activeCtx, state.categories, editChoice.data);
    } else if (editChoice.data.startsWith('cat:del:')) {
      const delOutcome = await confirmAndDeleteCategory(conversation, activeCtx, catId);
      if (delOutcome === 'cancel') return 'cancel';
      if (delOutcome === 'deleted') return 'done';
    }
  }
}

async function reorderSingleCategory(
  conversation: MyConversation,
  activeCtx: ConversationContext,
  categories: readonly PackageCategory[],
  callback: string
): Promise<void> {
  const isUp = callback.startsWith('cat:up:');
  const catId = callback.slice(isUp ? 'cat:up:'.length : 'cat:down:'.length);
  const index = categories.findIndex((c) => c.id === catId);
  if (index === -1) return;
  const targetIndex = isUp ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= categories.length) return;

  const reordered = [...categories];
  const [moved] = reordered.splice(index, 1);
  if (moved) reordered.splice(targetIndex, 0, moved);

  await conversation.external(async (outsideCtx) => {
    const services = outsideCtx?.services ?? activeCtx.services;
    if (!services) return;
    await services.packageCategoryService.reorderCategories(reordered.map((c) => c.id));
  });
}

async function confirmAndDeleteCategory(
  conversation: MyConversation,
  activeCtx: ConversationContext,
  catId: string
): Promise<'deleted' | 'unchanged' | 'cancel'> {
  const category = await conversation.external(async (outsideCtx) =>
    (outsideCtx?.services ?? activeCtx.services)?.packageCategoryService.getCategoryById(catId)
  );
  if (!category) return 'unchanged';

  const confirmKeyboard = new InlineKeyboard()
    .text(t(activeCtx, 'admin_confirm_button'), callbackData('cat:del-confirm', catId))
    .row()
    .text(t(activeCtx, 'menu_cancel'), 'cat:del-cancel');

  await promptInConversation(
    conversation,
    activeCtx,
    buildScreen({
      emoji: '⚠️',
      title: t(activeCtx, 'admin_category_manager_title'),
      primary: {
        emoji: '🏷️',
        label: t(activeCtx, 'admin_pkg_category_label'),
        value: escapeTelegramMarkdown(category.name),
      },
      footer: t(activeCtx, 'admin_category_delete_confirm', {
        name: escapeTelegramMarkdown(category.name),
      }),
    }),
    { parse_mode: 'Markdown', reply_markup: confirmKeyboard }
  );

  const confirmation = await waitForSettingsInput(conversation, {
    callbackPrefixes: ['cat:del-confirm:'],
    backCallbacks: ['cat:del-cancel'],
    retryKeyboard: confirmKeyboard,
  });

  if (confirmation.type === 'cancel') return 'cancel';
  if (
    confirmation.type !== 'callback' ||
    confirmation.data !== callbackData('cat:del-confirm', catId)
  ) {
    return 'unchanged';
  }

  await conversation.external(async (outsideCtx) => {
    if (!outsideCtx.services) return;
    await outsideCtx.services.packageCategoryService.deleteCategory(catId);
  });
  return 'deleted';
}

// ── Package Settings & Display Mode Subflow ────────────────────────────────

export async function managePackagePolicies(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<PackageManagerOutcome> {
  if (!ctx.services) return 'cancel';

  let activeCtx = ctx;

  for (;;) {
    const policy = await conversation.external((outsideCtx) => {
      if (!outsideCtx.services) return undefined;
      const ts = outsideCtx.services.translationService;
      return {
        displayMode: ts.getSetting('package_display_mode', 'specs'),
        lowTraffic: ts.getSettingNum('low_traffic_threshold_gb', 2),
        expiryDays: ts.getSettingNum('expiry_warning_days', 3),
        refundHours: ts.getSettingNum('refund_window_hours', 0),
        samplePackage:
          currentPackages(outsideCtx)[0] ??
          ({
            id: 'pkg_50gb_30d',
            name: 'پلن طلایی | Gold Plan',
            gbAmount: 50,
            durationDays: 30,
            price: 150_000,
          } satisfies PackageOption),
      };
    });
    if (!policy) return 'cancel';

    const modeLabel =
      policy.displayMode === 'name'
        ? t(activeCtx, 'admin_pkg_display_mode_name')
        : t(activeCtx, 'admin_pkg_display_mode_specs');
    const previewButtonLabel = formatPackageButtonLabel(activeCtx, policy.samplePackage);

    const screenText = buildScreen({
      emoji: '⚙️',
      title: t(activeCtx, 'admin_sales_package_policy_title'),
      subtitle: t(activeCtx, 'admin_setting_package_display_mode_desc'),
      primary: {
        emoji: '📺',
        label: t(activeCtx, 'admin_setting_package_display_mode'),
        value: `${modeLabel}\n👁️ \`${sanitizeTelegramInlineCode(previewButtonLabel)}\``,
      },
      sections: [
        {
          emoji: '📏',
          title: t(activeCtx, 'admin_setting_group_pricing'),
          fields: [
            {
              emoji: '📉',
              label: t(activeCtx, 'admin_setting_low_traffic_threshold_gb'),
              value: `${localizedNumber(policy.lowTraffic, activeCtx)} ${t(
                activeCtx,
                'traffic_unit_gb'
              )}`,
            },
            {
              emoji: '⏳',
              label: t(activeCtx, 'admin_setting_expiry_warning_days'),
              value: `${localizedNumber(policy.expiryDays, activeCtx)} ${t(
                activeCtx,
                'days_unit'
              )}`,
            },
            {
              emoji: '🛡',
              label: t(activeCtx, 'admin_setting_refund_window_hours'),
              value:
                policy.refundHours > 0
                  ? `${localizedNumber(policy.refundHours, activeCtx)} ${t(
                      activeCtx,
                      'hours_unit'
                    )}`
                  : t(activeCtx, 'admin_pkg_unlimited_refund'),
            },
          ],
        },
      ],
      footer: `ℹ️ ${t(activeCtx, 'admin_home_hint')}`,
    });

    const keyboard = new InlineKeyboard()
      .text(
        truncateButtonLabel(t(activeCtx, 'admin_pkg_display_toggle_btn', { mode: modeLabel })),
        'pp:toggle:mode'
      )
      .row()
      .text(
        truncateButtonLabel(t(activeCtx, 'admin_setting_low_traffic_threshold_gb')),
        'pp:edit:low_traffic_threshold_gb'
      )
      .text(
        truncateButtonLabel(t(activeCtx, 'admin_setting_expiry_warning_days')),
        'pp:edit:expiry_warning_days'
      )
      .row()
      .text(
        truncateButtonLabel(t(activeCtx, 'admin_setting_refund_window_hours')),
        'pp:edit:refund_window_hours'
      )
      .row()
      .text(t(activeCtx, 'admin_menu_back_to_packages'), 'pp:back');

    await renderSettingsScreen(conversation, activeCtx, screenText, keyboard);

    const input = await waitForSettingsInput(conversation, {
      callbackPrefixes: ['pp:toggle:', 'pp:edit:'],
      backCallbacks: ['pp:back'],
      retryKeyboard: keyboard,
    });

    if (input.type === 'cancel') return 'cancel';
    if (input.type === 'back') return 'back';
    if (input.type !== 'callback') continue;
    activeCtx = input.ctx;

    if (input.data === 'pp:toggle:mode') {
      const nextMode = policy.displayMode === 'name' ? 'specs' : 'name';
      await conversation.external(async (outsideCtx) => {
        if (!outsideCtx.services) return;
        await outsideCtx.services.translationService.updateSetting(
          'package_display_mode',
          nextMode
        );
      });
      continue;
    }

    if (input.data.startsWith('pp:edit:')) {
      const key = input.data.slice('pp:edit:'.length);
      const definition = getSettingDefinition(key);
      if (definition) {
        const outcome = await editSetting(conversation, activeCtx, definition);
        if (outcome === 'cancel') return 'cancel';
      }
    }
  }
}
