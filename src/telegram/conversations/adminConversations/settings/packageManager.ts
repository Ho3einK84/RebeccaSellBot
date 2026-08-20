import { InlineKeyboard } from 'grammy';
import type { PackageOption } from '../../../../domain/services/PricingService.js';
import {
  MAX_PACKAGE_COUNT,
  parsePackageOptionsJson,
} from '../../../../domain/services/PricingService.js';
import type { ConversationContext, MyConversation } from '../../../types.js';
import { localizedNumber, t, tm } from '../../../locale.js';
import { callbackData } from '../../../callbackData.js';
import { escapeTelegramMarkdown } from '../../../rendering.js';
import {
  buildEmptyState,
  buildScreen,
  isMessageNotModifiedError,
  promptInConversation,
  replyInAdminConversation,
} from '../../../ui.js';
import {
  buildPackageManagerScreen,
  buildSettingsPrompt,
  truncateButtonLabel,
} from './presentation.js';
import { waitForSettingsInput } from './navigation.js';
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
  await managePackages(conversation, ctx);
  await conversation.external(async (outsideCtx) => {
    await renderSalesMenu(outsideCtx);
  });
}

export async function managePackages(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<PackageManagerOutcome> {
  if (!ctx.services) return 'cancel';
  let packages = currentPackages(ctx);
  let page = 0;
  let activeCtx: ConversationContext = ctx;

  for (;;) {
    page = clampPackagePage(page, packages.length);
    const pageCount = packagePageCount(packages.length);
    const visiblePackages = packages.slice(
      page * PACKAGE_PAGE_SIZE,
      (page + 1) * PACKAGE_PAGE_SIZE
    );
    const keyboard = buildPackageManagerKeyboard(ctx, packages, page);
    const screenText = buildPackageManagerScreen(ctx, visiblePackages, {
      totalCount: packages.length,
      page,
      totalPages: pageCount,
    });

    let renderedInPlace = false;
    const messageId = activeCtx.callbackQuery?.message?.message_id;
    const chatId = activeCtx.chat?.id;
    if (messageId !== undefined && chatId !== undefined && activeCtx.api) {
      try {
        await activeCtx.api.editMessageText(chatId, messageId, screenText, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
        renderedInPlace = true;
      } catch (error) {
        if (isMessageNotModifiedError(error)) {
          renderedInPlace = true;
        }
      }
    }

    if (!renderedInPlace) {
      await promptInConversation(conversation, activeCtx, screenText, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    }

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
      packages = currentPackages(ctx);
      continue;
    }

    if (input.data === 'pkg-settings') {
      const outcome = await managePackagePolicies(conversation, activeCtx);
      if (outcome === 'cancel') return 'cancel';
      continue;
    }

    let nextPackages: PackageOption[] | undefined;
    if (input.data.startsWith('pkg-page:')) {
      const requestedPage = parsePackageIndex(input.data, 'pkg-page:');
      if (requestedPage !== undefined && requestedPage < pageCount) page = requestedPage;
      continue;
    } else if (input.data.startsWith('pkg-toggle:')) {
      const pkgId = input.data.slice('pkg-toggle:'.length);
      const existing = packages.find((pkg) => pkg.id === pkgId);
      if (!existing) continue;
      const currentEnabled = existing.enabled !== false;
      const updatedPkg = { ...existing, enabled: !currentEnabled };
      nextPackages = packages.map((pkg) => (pkg.id === pkgId ? updatedPkg : pkg));
    } else if (input.data.startsWith('pkg-clone:')) {
      const pkgId = input.data.slice('pkg-clone:'.length);
      const index = packages.findIndex((pkg) => pkg.id === pkgId);
      const existing = index === -1 ? undefined : packages[index];
      if (!existing || index === -1) continue;
      if (packages.length >= MAX_PACKAGE_COUNT) {
        const action = await showPackageNotice(
          conversation,
          ctx,
          buildEmptyState(
            '⚠️',
            t(ctx, 'admin_package_manager_title'),
            t(ctx, 'admin_pkg_limit_reached', { count: localizedNumber(MAX_PACKAGE_COUNT, ctx) })
          )
        );
        if (action !== 'continue') return action;
        continue;
      }
      const cloneSuffix = t(ctx, 'admin_pkg_copy_suffix');
      const cloneName = `${existing.name} ${cloneSuffix}`.slice(0, 120);
      const cloneId = generatePackageId(cloneName, packages);
      const clonedPkg: PackageOption = {
        ...existing,
        id: cloneId,
        name: cloneName,
        enabled: existing.enabled ?? true,
      };
      nextPackages = [...packages.slice(0, index + 1), clonedPkg, ...packages.slice(index + 1)];
    } else if (input.data.startsWith('pkg-up:')) {
      const pkgId = input.data.slice('pkg-up:'.length);
      const index = packages.findIndex((pkg) => pkg.id === pkgId);
      if (index <= 0 || index >= packages.length) continue;
      const reordered = [...packages];
      const current = reordered[index]!;
      const prev = reordered[index - 1]!;
      reordered[index - 1] = current;
      reordered[index] = prev;
      nextPackages = reordered;
    } else if (input.data.startsWith('pkg-down:')) {
      const pkgId = input.data.slice('pkg-down:'.length);
      const index = packages.findIndex((pkg) => pkg.id === pkgId);
      if (index < 0 || index >= packages.length - 1) continue;
      const reordered = [...packages];
      const current = reordered[index]!;
      const next = reordered[index + 1]!;
      reordered[index + 1] = current;
      reordered[index] = next;
      nextPackages = reordered;
    } else if (input.data === 'pkg-add') {
      if (packages.length >= MAX_PACKAGE_COUNT) {
        const action = await showPackageNotice(
          conversation,
          ctx,
          buildEmptyState(
            '⚠️',
            t(ctx, 'admin_package_manager_title'),
            t(ctx, 'admin_pkg_limit_reached', { count: localizedNumber(MAX_PACKAGE_COUNT, ctx) })
          )
        );
        if (action !== 'continue') return action;
        continue;
      }
      const created = await promptPackageFields(conversation, ctx, packages);
      if (created.type === 'cancel') return 'cancel';
      if (created.type === 'back') continue;
      if (hasDuplicatePackageName(packages, created.value.name)) {
        const action = await showPackageNotice(
          conversation,
          ctx,
          buildEmptyState(
            '⚠️',
            t(ctx, 'admin_package_manager_title'),
            t(ctx, 'admin_pkg_duplicate_name')
          )
        );
        if (action !== 'continue') return action;
        continue;
      }
      nextPackages = [...packages, created.value];
    } else if (input.data.startsWith('pkg-edit:')) {
      const pkgId = input.data.slice('pkg-edit:'.length);
      const index = packages.findIndex((pkg) => pkg.id === pkgId);
      const existing = index === -1 ? undefined : packages[index];
      if (!existing || index === -1) continue;
      const updated = await promptPackageFields(conversation, ctx, packages, existing);
      if (updated.type === 'cancel') return 'cancel';
      if (updated.type === 'back') continue;
      if (hasDuplicatePackageName(packages, updated.value.name, index)) {
        const action = await showPackageNotice(
          conversation,
          ctx,
          buildEmptyState(
            '⚠️',
            t(ctx, 'admin_package_manager_title'),
            t(ctx, 'admin_pkg_duplicate_name')
          )
        );
        if (action !== 'continue') return action;
        continue;
      }
      nextPackages = packages.map((pkg) => (pkg.id === pkgId ? updated.value : pkg));
    } else if (input.data.startsWith('pkg-del:')) {
      const pkgId = input.data.slice('pkg-del:'.length);
      const existing = packages.find((pkg) => pkg.id === pkgId);
      if (!existing) continue;
      if (packages.length <= 1) {
        const action = await showPackageNotice(
          conversation,
          ctx,
          buildEmptyState(
            '⚠️',
            t(ctx, 'admin_package_manager_title'),
            t(ctx, 'admin_pkg_last_removed')
          )
        );
        if (action !== 'continue') return action;
        continue;
      }
      const confirmKeyboard = new InlineKeyboard()
        .text(t(ctx, 'admin_confirm_button'), callbackData('pkg-del-confirm', pkgId))
        .row()
        .text(t(ctx, 'menu_cancel'), 'pkg-del-cancel');
      await promptInConversation(
        conversation,
        ctx,
        buildScreen({
          emoji: '⚠️',
          title: t(ctx, 'admin_package_manager_title'),
          primary: {
            emoji: '📦',
            label: t(ctx, 'checkout_package_section'),
            value: escapeTelegramMarkdown(existing.name),
          },
          footer: t(ctx, 'admin_pkg_delete_confirm', {
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
      if (confirmation.type === 'cancel') return 'cancel';
      if (
        confirmation.type !== 'callback' ||
        confirmation.data !== callbackData('pkg-del-confirm', pkgId)
      ) {
        continue;
      }
      nextPackages = packages.filter((pkg) => pkg.id !== pkgId);
    }

    if (!nextPackages) continue;
    try {
      await conversation.external(async (outsideCtx) => {
        if (!outsideCtx.services) throw new Error('SETTINGS_SERVICES_UNAVAILABLE');
        await outsideCtx.services.translationService.updateSetting(
          'packages_json',
          JSON.stringify(nextPackages)
        );
      });
    } catch {
      const action = await showPackageNotice(
        conversation,
        ctx,
        buildEmptyState(
          '⚠️',
          t(ctx, 'admin_package_manager_title'),
          t(ctx, 'admin_setting_save_failed')
        )
      );
      if (action !== 'continue') return action;
      continue;
    }

    packages = nextPackages;
    page = clampPackagePage(page, packages.length);
  }
}

export function buildPackageManagerKeyboard(
  ctx: ConversationContext,
  packages: readonly PackageOption[],
  page = 0
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const safePage = clampPackagePage(page, packages.length);
  const pageCount = packagePageCount(packages.length);
  const startIndex = safePage * PACKAGE_PAGE_SIZE;
  packages.slice(startIndex, startIndex + PACKAGE_PAGE_SIZE).forEach((pkg, offset) => {
    const index = startIndex + offset;
    const isEnabled = pkg.enabled !== false;
    const statusIcon = isEnabled ? '🟢' : '⚪️';
    const statusBadge = isEnabled
      ? t(ctx, 'admin_pkg_active_badge')
      : t(ctx, 'admin_pkg_inactive_badge');
    const panel = pkg.panelId ? ctx.services?.panelRegistry.getPanel(pkg.panelId) : undefined;
    const service = panel?.services.find((item) => item.serviceId === pkg.serviceId);
    const target =
      panel && service
        ? ` · ${panel.name}/${service.name}`
        : ` · ${t(ctx, 'admin_pkg_default_target')}`;
    keyboard
      .text(
        truncateButtonLabel(`${statusIcon} ${pkg.name}${target} ✏️`),
        callbackData('pkg-edit', pkg.id)
      )
      .row();

    keyboard.text(statusBadge, callbackData('pkg-toggle', pkg.id));

    if (index > 0) {
      keyboard.text('🔼', callbackData('pkg-up', pkg.id));
    }
    if (index < packages.length - 1) {
      keyboard.text('🔽', callbackData('pkg-down', pkg.id));
    }

    keyboard
      .text(`📋 ${t(ctx, 'admin_pkg_clone')}`, callbackData('pkg-clone', pkg.id))
      .text('🗑', callbackData('pkg-del', pkg.id))
      .row();
  });
  if (safePage > 0) {
    keyboard.text(t(ctx, 'pagination_previous'), callbackData('pkg-page', safePage - 1));
  }
  if (safePage + 1 < pageCount) {
    keyboard.text(t(ctx, 'pagination_next'), callbackData('pkg-page', safePage + 1));
  }
  if (pageCount > 1) keyboard.row();

  return keyboard
    .text(t(ctx, 'admin_pkg_add'), 'pkg-add')
    .row()
    .text(t(ctx, 'admin_pkg_categories_button'), 'pkg-categories')
    .text(t(ctx, 'admin_sales_package_policy_title'), 'pkg-settings')
    .row()
    .text(t(ctx, 'admin_menu_back_to_sales'), 'pkg-back');
}

export function generatePackageId(name: string, packages: readonly PackageOption[]): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '_')
      .replace(/^_+|_+$/gu, '')
      .slice(0, 32) || 'package';
  const base = `pkg_${slug}`;
  const ids = new Set(packages.map((pkg) => pkg.id));
  if (!ids.has(base)) return base;
  for (let suffix = 2; suffix <= 999; suffix++) {
    const candidate = `${base.slice(0, 50 - String(suffix).length)}_${suffix}`;
    if (!ids.has(candidate)) return candidate;
  }
  throw new Error('PACKAGE_ID_SPACE_EXHAUSTED');
}

async function promptPackageFields(
  conversation: MyConversation,
  ctx: ConversationContext,
  packages: readonly PackageOption[],
  existing?: PackageOption
): Promise<FieldResult<PackageOption>> {
  const name = await askPackageString(
    conversation,
    ctx,
    'admin_pkg_name_prompt',
    existing?.name,
    (value) => value.length >= 1 && value.length <= 120
  );
  if (name.type !== 'value') return name;

  const gbAmount = await askPackageInteger(
    conversation,
    ctx,
    'admin_pkg_gb_prompt',
    existing?.gbAmount,
    1,
    10_000
  );
  if (gbAmount.type !== 'value') return gbAmount;

  const durationDays = await askPackageInteger(
    conversation,
    ctx,
    'admin_pkg_days_prompt',
    existing?.durationDays,
    1,
    3_650
  );
  if (durationDays.type !== 'value') return durationDays;

  const price = await askPackageInteger(
    conversation,
    ctx,
    'admin_pkg_price_prompt',
    existing?.price,
    1,
    Number.MAX_SAFE_INTEGER
  );
  if (price.type !== 'value') return price;

  const categoryResult = await choosePackageCategory(conversation, ctx, existing?.categoryId);
  if (categoryResult.type === 'cancel') return categoryResult;

  const target = await choosePackageTarget(conversation, ctx, existing);
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
      categoryId: categoryResult.type === 'value' ? categoryResult.value : undefined,
    },
  };
}

async function choosePackageCategory(
  conversation: MyConversation,
  ctx: ConversationContext,
  existingCategoryId?: string
): Promise<FieldResult<string | undefined>> {
  const categories = (await ctx.services?.packageCategoryService?.listCategories(true)) ?? [];
  if (categories.length === 0) {
    return { type: 'value', value: undefined };
  }

  const keyboard = new InlineKeyboard();
  keyboard
    .text(`${!existingCategoryId ? '✅ ' : ''}${t(ctx, 'admin_pkg_no_category')}`, 'pkg-cat:none')
    .row();

  for (const cat of categories) {
    const isSelected = existingCategoryId === cat.id;
    const label = `${isSelected ? '✅ ' : ''}${cat.icon ? cat.icon + ' ' : ''}${cat.name}`;
    keyboard.text(label, callbackData('pkg-cat', cat.id)).row();
  }

  keyboard.text(t(ctx, 'admin_pkg_cancel_edit'), 'pkg-field-back');

  await promptInConversation(
    conversation,
    ctx,
    buildSettingsPrompt(ctx, t(ctx, 'admin_pkg_select_category_prompt'), { emoji: '🏷️' }),
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
  existing?: PackageOption
): Promise<FieldResult<{ panelId: string; serviceId: number }>> {
  const panels = ctx.services?.panelRegistry
    .listPanels()
    .filter((panel) => panel.enabled && panel.services.length > 0);
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
      const label = `${selected ? '✅ ' : ''}${panel.name} / ${service.name}`;
      keyboard.text(label, callbackData('pkg-target', `${panel.id}:${service.serviceId}`)).row();
    }
  }
  keyboard.text(t(ctx, 'admin_pkg_cancel_edit'), 'pkg-field-back');
  await promptInConversation(
    conversation,
    ctx,
    buildSettingsPrompt(ctx, t(ctx, 'admin_pkg_target_prompt'), { emoji: '🎯' }),
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
  validate: (value: string) => boolean
): Promise<FieldResult<string>> {
  const keyboard = packageFieldKeyboard(ctx);
  const prompt = tm(
    ctx,
    promptKey,
    {
      current: escapeTelegramMarkdown(existingValue ?? '—'),
    },
    ['current']
  );
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
  maximum: number
): Promise<FieldResult<number>> {
  const keyboard = packageFieldKeyboard(ctx);
  const prompt = tm(
    ctx,
    promptKey,
    {
      current: existingValue !== undefined ? localizedNumber(existingValue, ctx) : '—',
      min: localizedNumber(minimum, ctx),
      max: localizedNumber(maximum, ctx),
    },
    ['current', 'min', 'max']
  );
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
    const normalized = input.value
      .replace(/[۰-۹]/gu, (digit) => String(digit.charCodeAt(0) - 0x06f0))
      .replace(/[٠-٩]/gu, (digit) => String(digit.charCodeAt(0) - 0x0660))
      .replace(/[,_،٬\s]/gu, '');
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

function hasDuplicatePackageName(
  packages: readonly PackageOption[],
  name: string,
  ignoredIndex = -1
): boolean {
  const normalized = name.trim().toLocaleLowerCase('en-US');
  return packages.some(
    (pkg, index) =>
      index !== ignoredIndex && pkg.name.trim().toLocaleLowerCase('en-US') === normalized
  );
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
    const categories = await ctx.services.packageCategoryService.listCategories(true);

    const keyboard = new InlineKeyboard();
    for (const [index, cat] of categories.entries()) {
      const isEnabled = cat.enabled;
      const statusIcon = isEnabled ? '🟢' : '⚪️';
      const label = `${statusIcon} ${cat.icon ? cat.icon + ' ' : ''}${cat.name}`;

      keyboard.text(label, callbackData('cat:edit', cat.id)).row();

      if (index > 0) {
        keyboard.text('🔼', callbackData('cat:up', cat.id));
      }
      if (index < categories.length - 1) {
        keyboard.text('🔽', callbackData('cat:down', cat.id));
      }
      keyboard.text('🗑', callbackData('cat:del', cat.id)).row();
    }

    keyboard
      .text(t(ctx, 'admin_category_add_button'), 'cat:add')
      .row()
      .text(t(ctx, 'admin_menu_back_to_packages'), 'cat:back');

    const screenText = buildScreen({
      emoji: '🏷️',
      title: t(ctx, 'admin_category_manager_title'),
      subtitle: t(ctx, 'admin_category_manager_subtitle'),
      footer: `ℹ️ ${t(ctx, 'admin_home_hint')}`,
    });

    let renderedInPlace = false;
    const messageId = activeCtx.callbackQuery?.message?.message_id;
    const chatId = activeCtx.chat?.id;
    if (messageId !== undefined && chatId !== undefined && activeCtx.api) {
      try {
        await activeCtx.api.editMessageText(chatId, messageId, screenText, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
        renderedInPlace = true;
      } catch (error) {
        if (isMessageNotModifiedError(error)) {
          renderedInPlace = true;
        }
      }
    }

    if (!renderedInPlace) {
      await promptInConversation(conversation, activeCtx, screenText, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    }

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
        ctx,
        'admin_category_name_prompt',
        undefined,
        (val) => val.length >= 1 && val.length <= 100
      );
      if (nameResult.type !== 'value') continue;

      const iconResult = await askPackageString(
        conversation,
        ctx,
        'admin_category_icon_prompt',
        undefined,
        () => true
      );
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

    if (input.data.startsWith('cat:up:')) {
      const catId = input.data.slice('cat:up:'.length);
      const index = categories.findIndex((c) => c.id === catId);
      if (index > 0) {
        const reordered = [...categories];
        const [removed] = reordered.splice(index, 1);
        if (removed) reordered.splice(index - 1, 0, removed);
        await conversation.external(async (outsideCtx) => {
          if (!outsideCtx.services) return;
          await outsideCtx.services.packageCategoryService.reorderCategories(
            reordered.map((c) => c.id)
          );
        });
      }
      continue;
    }

    if (input.data.startsWith('cat:down:')) {
      const catId = input.data.slice('cat:down:'.length);
      const index = categories.findIndex((c) => c.id === catId);
      if (index >= 0 && index < categories.length - 1) {
        const reordered = [...categories];
        const [removed] = reordered.splice(index, 1);
        if (removed) reordered.splice(index + 1, 0, removed);
        await conversation.external(async (outsideCtx) => {
          if (!outsideCtx.services) return;
          await outsideCtx.services.packageCategoryService.reorderCategories(
            reordered.map((c) => c.id)
          );
        });
      }
      continue;
    }

    if (input.data.startsWith('cat:edit:')) {
      const catId = input.data.slice('cat:edit:'.length);
      const existing = categories.find((c) => c.id === catId);
      if (!existing) continue;

      const editMenu = new InlineKeyboard()
        .text(t(ctx, 'admin_panel_edit_name_button'), callbackData('cat:edit-name', catId))
        .text(
          '🎨 ' + t(ctx, 'admin_category_icon_prompt').slice(0, 10),
          callbackData('cat:edit-icon', catId)
        )
        .row()
        .text(
          `${existing.enabled ? t(ctx, 'admin_panel_disable_button') : t(ctx, 'admin_panel_enable_button')}`,
          callbackData('cat:toggle', catId)
        )
        .row()
        .text(t(ctx, 'admin_menu_back_to_categories'), 'cat:edit-back');

      await promptInConversation(
        conversation,
        ctx,
        buildScreen({
          emoji: '🏷️',
          title: existing.name,
          primary: {
            emoji: existing.icon || '📦',
            label: t(ctx, 'admin_pkg_category_label'),
            value: existing.name,
          },
        }),
        { parse_mode: 'Markdown', reply_markup: editMenu }
      );

      const editChoice = await waitForSettingsInput(conversation, {
        callbackPrefixes: ['cat:edit-name:', 'cat:edit-icon:', 'cat:toggle:'],
        backCallbacks: ['cat:edit-back'],
        retryKeyboard: editMenu,
      });

      if (editChoice.type !== 'callback') continue;

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
          ctx,
          'admin_category_name_prompt',
          existing.name,
          (val) => val.length >= 1 && val.length <= 100
        );
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
          ctx,
          'admin_category_icon_prompt',
          existing.icon ?? undefined,
          () => true
        );
        if (newIcon.type === 'value') {
          await conversation.external(async (outsideCtx) => {
            if (!outsideCtx.services) return;
            await outsideCtx.services.packageCategoryService.updateCategory(catId, {
              icon: newIcon.value !== '-' ? newIcon.value : undefined,
            });
          });
        }
      }
      continue;
    }

    if (input.data.startsWith('cat:up:') || input.data.startsWith('cat:down:')) {
      const isUp = input.data.startsWith('cat:up:');
      const catId = input.data.slice(isUp ? 'cat:up:'.length : 'cat:down:'.length);
      const index = categories.findIndex((c) => c.id === catId);
      if (index === -1) continue;
      const targetIndex = isUp ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= categories.length) continue;

      const reordered = [...categories];
      const [moved] = reordered.splice(index, 1);
      if (moved) reordered.splice(targetIndex, 0, moved);

      await conversation.external(async (outsideCtx) => {
        if (!outsideCtx.services) return;
        await outsideCtx.services.packageCategoryService.reorderCategories(
          reordered.map((c) => c.id)
        );
      });
      continue;
    }

    if (input.data.startsWith('cat:del:')) {
      const catId = input.data.slice('cat:del:'.length);
      const category = await ctx.services.packageCategoryService.getCategoryById(catId);
      if (!category) continue;

      const confirmKeyboard = new InlineKeyboard()
        .text(t(ctx, 'admin_confirm_button'), callbackData('cat:del-confirm', catId))
        .row()
        .text(t(ctx, 'menu_cancel'), 'cat:del-cancel');

      await promptInConversation(
        conversation,
        ctx,
        buildScreen({
          emoji: '⚠️',
          title: t(ctx, 'admin_category_manager_title'),
          primary: {
            emoji: '🏷️',
            label: t(ctx, 'admin_pkg_category_label'),
            value: escapeTelegramMarkdown(category.name),
          },
          footer: t(ctx, 'admin_category_delete_confirm', {
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
        continue;
      }

      await conversation.external(async (outsideCtx) => {
        if (!outsideCtx.services) return;
        await outsideCtx.services.packageCategoryService.deleteCategory(catId);
      });
      continue;
    }
  }
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
      };
    });
    if (!policy) return 'cancel';

    const modeLabel =
      policy.displayMode === 'name'
        ? t(activeCtx, 'admin_pkg_display_mode_name')
        : t(activeCtx, 'admin_pkg_display_mode_specs');

    const screenText = buildScreen({
      emoji: '⚙️',
      title: t(activeCtx, 'admin_sales_package_policy_title'),
      subtitle: t(activeCtx, 'admin_setting_package_display_mode_desc'),
      primary: {
        emoji: '📺',
        label: t(activeCtx, 'admin_setting_package_display_mode'),
        value: modeLabel,
      },
      sections: [
        {
          emoji: '📏',
          title: t(activeCtx, 'admin_setting_group_pricing'),
          fields: [
            {
              label: t(activeCtx, 'admin_setting_low_traffic_threshold_gb'),
              value: `${localizedNumber(policy.lowTraffic, activeCtx)} ${t(
                activeCtx,
                'traffic_unit_gb'
              )}`,
            },
            {
              label: t(activeCtx, 'admin_setting_expiry_warning_days'),
              value: `${localizedNumber(policy.expiryDays, activeCtx)} ${t(
                activeCtx,
                'days_unit'
              )}`,
            },
            {
              label: t(activeCtx, 'admin_setting_refund_window_hours'),
              value: `${localizedNumber(policy.refundHours, activeCtx)} ${t(
                activeCtx,
                'hours_unit'
              )}`,
            },
          ],
        },
      ],
      footer: `ℹ️ ${t(activeCtx, 'admin_home_hint')}`,
    });

    const keyboard = new InlineKeyboard()
      .text(`${t(activeCtx, 'admin_setting_package_display_mode')}: ${modeLabel}`, 'pp:toggle:mode')
      .row()
      .text(
        t(activeCtx, 'admin_setting_low_traffic_threshold_gb'),
        'pp:edit:low_traffic_threshold_gb'
      )
      .row()
      .text(t(activeCtx, 'admin_setting_expiry_warning_days'), 'pp:edit:expiry_warning_days')
      .row()
      .text(t(activeCtx, 'admin_setting_refund_window_hours'), 'pp:edit:refund_window_hours')
      .row()
      .text(t(activeCtx, 'admin_menu_back_to_packages'), 'pp:back');

    let renderedInPlace = false;
    const messageId = activeCtx.callbackQuery?.message?.message_id;
    const chatId = activeCtx.chat?.id;
    if (messageId !== undefined && chatId !== undefined && activeCtx.api) {
      try {
        await activeCtx.api.editMessageText(chatId, messageId, screenText, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
        renderedInPlace = true;
      } catch (error) {
        if (isMessageNotModifiedError(error)) {
          renderedInPlace = true;
        }
      }
    }

    if (!renderedInPlace) {
      await promptInConversation(conversation, activeCtx, screenText, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    }

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
        activeCtx = ctx;
      }
    }
  }
}
