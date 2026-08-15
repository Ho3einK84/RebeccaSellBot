import { InlineKeyboard } from 'grammy';
import type { PackageOption } from '../../../../domain/services/PricingService.js';
import {
  MAX_PACKAGE_COUNT,
  parsePackageOptionsJson,
} from '../../../../domain/services/PricingService.js';
import type { ConversationContext, MyConversation } from '../../../types.js';
import { localizedNumber, t, tm } from '../../../locale.js';
import { callbackData } from '../../../callbackData.js';
import { packageCatalogToken } from '../../../packageCatalog.js';
import { escapeTelegramMarkdown } from '../../../rendering.js';
import {
  buildEmptyState,
  buildScreen,
  promptInConversation,
  replyInAdminConversation,
} from '../../../ui.js';
import {
  buildPackageManagerScreen,
  buildSettingsPrompt,
  truncateButtonLabel,
} from './presentation.js';
import { waitForSettingsInput } from './navigation.js';

export type PackageManagerOutcome = 'back' | 'cancel';
type FieldResult<T> = { type: 'value'; value: T } | { type: 'back' } | { type: 'cancel' };
const PACKAGE_PAGE_SIZE = 8;

export async function managePackages(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<PackageManagerOutcome> {
  if (!ctx.services) return 'cancel';
  let packages = currentPackages(ctx);
  let page = 0;

  for (;;) {
    page = clampPackagePage(page, packages.length);
    const pageCount = packagePageCount(packages.length);
    const visiblePackages = packages.slice(
      page * PACKAGE_PAGE_SIZE,
      (page + 1) * PACKAGE_PAGE_SIZE
    );
    const keyboard = buildPackageManagerKeyboard(ctx, packages, page);
    await promptInConversation(
      conversation,
      ctx,
      buildPackageManagerScreen(ctx, visiblePackages, {
        totalCount: packages.length,
        page,
        totalPages: pageCount,
      }),
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      }
    );
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
      ],
      backCallbacks: ['pkg-back'],
      retryKeyboard: keyboard,
    });
    if (input.type === 'cancel') return 'cancel';
    if (input.type === 'back') return 'back';
    if (input.type !== 'callback') continue;

    let nextPackages: PackageOption[] | undefined;
    if (input.data.startsWith('pkg-page:')) {
      const requestedPage = parsePackageIndex(input.data, 'pkg-page:');
      if (requestedPage !== undefined && requestedPage < pageCount) page = requestedPage;
      continue;
    } else if (input.data.startsWith('pkg-toggle:')) {
      const index = parsePackageActionIndex(input.data, 'pkg-toggle:', packages);
      const existing = index === undefined ? undefined : packages[index];
      if (!existing || index === undefined) continue;
      const currentEnabled = existing.enabled !== false;
      const updatedPkg = { ...existing, enabled: !currentEnabled };
      nextPackages = packages.map((pkg, itemIndex) => (itemIndex === index ? updatedPkg : pkg));
    } else if (input.data.startsWith('pkg-clone:')) {
      const index = parsePackageActionIndex(input.data, 'pkg-clone:', packages);
      const existing = index === undefined ? undefined : packages[index];
      if (!existing || index === undefined) continue;
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
      const index = parsePackageActionIndex(input.data, 'pkg-up:', packages);
      if (index === undefined || index <= 0 || index >= packages.length) continue;
      const reordered = [...packages];
      const current = reordered[index]!;
      const prev = reordered[index - 1]!;
      reordered[index - 1] = current;
      reordered[index] = prev;
      nextPackages = reordered;
    } else if (input.data.startsWith('pkg-down:')) {
      const index = parsePackageActionIndex(input.data, 'pkg-down:', packages);
      if (index === undefined || index < 0 || index >= packages.length - 1) continue;
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
      const index = parsePackageActionIndex(input.data, 'pkg-edit:', packages);
      const existing = index === undefined ? undefined : packages[index];
      if (!existing || index === undefined) continue;
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
      nextPackages = packages.map((pkg, itemIndex) => (itemIndex === index ? updated.value : pkg));
    } else if (input.data.startsWith('pkg-del:')) {
      const index = parsePackageActionIndex(input.data, 'pkg-del:', packages);
      const existing = index === undefined ? undefined : packages[index];
      if (!existing || index === undefined) continue;
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
      const catalogToken = packageCatalogToken(packages);
      const confirmKeyboard = new InlineKeyboard()
        .text(t(ctx, 'admin_confirm_button'), callbackData('pkg-del-confirm', catalogToken, index))
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
        confirmation.data !== callbackData('pkg-del-confirm', catalogToken, index)
      ) {
        continue;
      }
      nextPackages = packages.filter((_, itemIndex) => itemIndex !== index);
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
  const catalogToken = packageCatalogToken(packages);
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
        callbackData('pkg-edit', catalogToken, index)
      )
      .row();

    keyboard.text(statusBadge, callbackData('pkg-toggle', catalogToken, index));

    if (index > 0) {
      keyboard.text('🔼', callbackData('pkg-up', catalogToken, index));
    }
    if (index < packages.length - 1) {
      keyboard.text('🔽', callbackData('pkg-down', catalogToken, index));
    }

    keyboard
      .text(`📋 ${t(ctx, 'admin_pkg_clone')}`, callbackData('pkg-clone', catalogToken, index))
      .text('🗑', callbackData('pkg-del', catalogToken, index))
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
    .text(t(ctx, 'admin_settings_back_category'), 'pkg-back');
}

export function generatePackageId(name: string, packages: readonly PackageOption[]): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '_')
      .replace(/^_+|_+$/gu, '')
      .slice(0, 48) || 'package';
  const base = `pkg_${slug}`;
  const ids = new Set(packages.map((pkg) => pkg.id));
  if (!ids.has(base)) return base;
  for (let suffix = 2; suffix <= 999; suffix++) {
    const candidate = `${base.slice(0, 59 - String(suffix).length)}_${suffix}`;
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
    },
  };
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
      keyboard
        .text(
          truncateButtonLabel(
            `${selected ? '✅ ' : ''}${panel.name} · ${service.name} (${service.serviceId})`
          ),
          callbackData('pkg-target', panel.id, service.serviceId)
        )
        .row();
    }
  }
  keyboard.text(t(ctx, 'admin_settings_back_category'), 'pkg-field-back');
  await promptInConversation(
    conversation,
    ctx,
    buildSettingsPrompt(ctx, t(ctx, 'admin_pkg_target_prompt'), {
      emoji: '🎯',
      title: t(ctx, 'admin_package_manager_title'),
      subtitle: t(ctx, 'admin_package_manager_subtitle'),
    }),
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
  const input = await waitForSettingsInput(conversation, {
    callbackPrefixes: ['pkg-target:'],
    backCallbacks: ['pkg-field-back'],
    retryKeyboard: keyboard,
  });
  if (input.type === 'cancel') return { type: 'cancel' };
  if (input.type !== 'callback') return { type: 'back' };
  const match = /^pkg-target:([a-z0-9_-]{2,40}):(\d+)$/iu.exec(input.data);
  const serviceId = match ? Number(match[2]) : Number.NaN;
  const panel = match ? panels.find((candidate) => candidate.id === match[1]) : undefined;
  const service = panel?.services.find((candidate) => candidate.serviceId === serviceId);
  return panel && service && Number.isSafeInteger(serviceId) && serviceId > 0
    ? { type: 'value', value: { panelId: panel.id, serviceId } }
    : { type: 'back' };
}

async function askPackageString(
  conversation: MyConversation,
  ctx: ConversationContext,
  promptKey: string,
  current: string | undefined,
  validate: (value: string) => boolean
): Promise<FieldResult<string>> {
  const keyboard = packageFieldKeyboard(ctx);
  await promptInConversation(
    conversation,
    ctx,
    buildSettingsPrompt(ctx, tm(ctx, promptKey, { current: current ?? '—' }), {
      emoji: '✍️',
      title: t(ctx, 'admin_package_manager_title'),
      subtitle: t(ctx, 'admin_package_manager_subtitle'),
    }),
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
  for (;;) {
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
      buildEmptyState('⚠️', t(ctx, 'admin_package_manager_title'), t(ctx, 'admin_setting_invalid')),
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
  }
}

async function askPackageInteger(
  conversation: MyConversation,
  ctx: ConversationContext,
  promptKey: string,
  current: number | undefined,
  minimum: number,
  maximum: number
): Promise<FieldResult<number>> {
  const keyboard = packageFieldKeyboard(ctx);
  await promptInConversation(
    conversation,
    ctx,
    buildSettingsPrompt(ctx, t(ctx, promptKey, { current: current ?? '—' }), {
      emoji: '🔢',
      title: t(ctx, 'admin_package_manager_title'),
      subtitle: t(ctx, 'admin_package_manager_subtitle'),
    }),
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
  for (;;) {
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
    .text(t(ctx, 'admin_settings_back_category'), 'pkg-back');
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

function parsePackageActionIndex(
  data: string,
  prefix: string,
  packages: readonly PackageOption[]
): number | undefined {
  const match = /^([0-9a-f]{10}):(\d+)$/u.exec(data.slice(prefix.length));
  if (!match || match[1] !== packageCatalogToken(packages)) return undefined;
  const value = Number(match[2]);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function packagePageCount(packageCount: number): number {
  return Math.max(1, Math.ceil(packageCount / PACKAGE_PAGE_SIZE));
}

function clampPackagePage(page: number, packageCount: number): number {
  return Math.min(Math.max(0, page), packagePageCount(packageCount) - 1);
}
