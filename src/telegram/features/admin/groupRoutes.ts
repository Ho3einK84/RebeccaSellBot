import { InlineKeyboard } from 'grammy';
import type { AdminInputState, MenuContext } from '../../types.js';
import { localizedNumber, normalizeInputDigits, t } from '../../locale.js';
import {
  buildAdminEmptyState,
  buildAdminPromptScreen,
  buildAdminScreen,
  buildBreadcrumb,
  buildStatusBadge,
  renderScreen,
  type AdminScreenNotice,
} from '../../ui.js';
import { escapeTelegramMarkdown } from '../../rendering.js';
import {
  appendAdminFooterNav,
  buildAdminConfirmKeyboard,
  markAdminContext,
} from '../../admin/adminNav.js';
import { registerAdminRoute } from '../../admin/adminRouter.js';
import { registerAdminInputHandler, startAdminInput } from '../../admin/adminInput.js';
import {
  MAX_USER_GROUP_BADGE_LENGTH,
  MAX_USER_GROUP_DISCOUNT_PERCENT,
  MAX_USER_GROUP_NAME_LENGTH,
  type UserGroupRow,
} from '../../../domain/services/UserGroupService.js';

type ToggleField = 'cat' | 'prm' | 'cb' | 'whl' | 'nam' | 'cvd';
type EditField = 'name' | 'badge' | 'disc' | 'gb' | 'day' | 'cred';

function groupDisplayTitle(group: Pick<UserGroupRow, 'name' | 'badge' | 'isDefault'>): string {
  const star = group.isDefault ? '⭐ ' : '';
  const badge = group.badge?.trim() ? `${group.badge.trim()} ` : '';
  return `${star}${badge}${group.name}`;
}

export async function renderAdminGroupsList(
  ctx: MenuContext,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services?.userGroupService) return;
  markAdminContext(ctx);

  const groups = await ctx.services.userGroupService.listGroupsWithMemberCounts();
  const breadcrumb = buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_groups_title'));
  const kb = new InlineKeyboard();

  if (groups.length === 0) {
    kb.text(t(ctx, 'admin_groups_create_button'), 'adm:grp:new').row();
    appendAdminFooterNav(kb, ctx, {
      backCallback: 'adm:usr:p:1',
      backLabel: t(ctx, 'admin_menu_users'),
      showHome: true,
    });
    await renderScreen(
      ctx,
      buildAdminEmptyState('👥', t(ctx, 'admin_groups_title'), t(ctx, 'admin_groups_empty'), {
        breadcrumb,
        notice,
      }),
      { parse_mode: 'Markdown', reply_markup: kb }
    );
    return;
  }

  for (const [idx, group] of groups.entries()) {
    const discSuffix =
      group.discountPercent > 0 ? ` · -${localizedNumber(group.discountPercent, ctx)}%` : '';
    const credSuffix = group.creditLimit > 0 ? ' · 💳' : '';
    const label = `${groupDisplayTitle(group)} (${localizedNumber(group.memberCount, ctx)})${discSuffix}${credSuffix}`;
    kb.text(label, `adm:grp:vi:${idx}`).row();
  }

  if (ctx.session) {
    ctx.session.adminDraft = {
      ...(ctx.session.adminDraft ?? {}),
      groupIds: groups.map((g) => g.id),
    };
  }

  kb.text(t(ctx, 'admin_groups_create_button'), 'adm:grp:new').row();
  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:usr:p:1',
    backLabel: t(ctx, 'admin_menu_users'),
    showHome: true,
  });

  const currency = t(ctx, 'currency_toman');
  const text = buildAdminScreen({
    emoji: '👥',
    title: t(ctx, 'admin_groups_title'),
    subtitle: t(ctx, 'admin_groups_subtitle'),
    breadcrumb,
    notice,
    sections: groups.map((g) => ({
      title: `${g.isDefault ? '⭐ ' : ''}${escapeTelegramMarkdown(g.name)}${g.badge ? ` (${escapeTelegramMarkdown(g.badge)})` : ''}`,
      fields: [
        {
          label: t(ctx, 'admin_groups_members_label'),
          value: localizedNumber(g.memberCount, ctx),
        },
        {
          label: t(ctx, 'admin_groups_discount_label'),
          value: `${localizedNumber(g.discountPercent, ctx)}%`,
        },
        ...(g.creditLimit > 0
          ? [
              {
                label: t(ctx, 'admin_groups_credit_limit_label'),
                value: `${localizedNumber(g.creditLimit, ctx)} ${currency}`,
              },
            ]
          : []),
      ],
    })),
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

export async function renderAdminGroupDetail(
  ctx: MenuContext,
  groupId: string,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services?.userGroupService) return;
  markAdminContext(ctx);

  const groups = await ctx.services.userGroupService.listGroupsWithMemberCounts();
  const group = groups.find((g) => g.id === groupId);
  if (!group) {
    await renderAdminGroupsList(ctx, {
      tone: 'warning',
      text: t(ctx, 'admin_groups_not_found'),
    });
    return;
  }

  if (ctx.session) {
    ctx.session.adminDraft = {
      ...(ctx.session.adminDraft ?? {}),
      activeGroupId: group.id,
      groupIds: groups.map((g) => g.id),
    };
  }

  const currency = t(ctx, 'currency_toman');
  const onOff = (val: boolean) => buildStatusBadge(ctx, val ? 'active' : 'inactive');
  const toggleBtn = (val: boolean, labelKey: string) => `${val ? '🟢' : '⚪️'} ${t(ctx, labelKey)}`;

  const kb = new InlineKeyboard()
    .text(t(ctx, 'admin_groups_edit_name_btn'), 'adm:grp:e:name')
    .text(t(ctx, 'admin_groups_edit_badge_btn'), 'adm:grp:e:badge')
    .row()
    .text(t(ctx, 'admin_groups_edit_discount_btn'), 'adm:grp:e:disc')
    .text(t(ctx, 'admin_groups_edit_credit_btn'), 'adm:grp:e:cred')
    .row()
    .text(t(ctx, 'admin_groups_edit_gb_btn'), 'adm:grp:e:gb')
    .text(t(ctx, 'admin_groups_edit_day_btn'), 'adm:grp:e:day')
    .row()
    .text(toggleBtn(group.allowCatalogDiscounts, 'admin_groups_flag_catalog'), 'adm:grp:t:cat')
    .text(toggleBtn(group.allowPromoCodes, 'admin_groups_flag_promo'), 'adm:grp:t:prm')
    .row()
    .text(toggleBtn(group.allowCashback, 'admin_groups_flag_cashback'), 'adm:grp:t:cb')
    .text(toggleBtn(group.allowLuckyWheel, 'admin_groups_flag_wheel'), 'adm:grp:t:whl')
    .row()
    .text(toggleBtn(group.allowCustomServiceName, 'admin_groups_flag_custom_name'), 'adm:grp:t:nam')
    .text(
      toggleBtn(group.applyDiscountToCustomVolume, 'admin_groups_flag_custom_vol_discount'),
      'adm:grp:t:cvd'
    )
    .row();

  if (!group.isDefault) {
    kb.text(t(ctx, 'admin_groups_set_default_btn'), 'adm:grp:def').row();
  }
  kb.text(t(ctx, 'admin_groups_delete_btn'), 'adm:grp:del').row();

  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:grp:l',
    backLabel: t(ctx, 'admin_groups_title'),
    showHome: true,
  });

  const text = buildAdminScreen({
    emoji: group.isDefault ? '⭐' : '👥',
    title: escapeTelegramMarkdown(group.name),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_home_title'),
      t(ctx, 'admin_groups_title'),
      escapeTelegramMarkdown(group.name)
    ),
    notice,
    primary: {
      label: t(ctx, 'admin_groups_members_label'),
      value: `${localizedNumber(group.memberCount, ctx)}${group.isDefault ? ` · ${t(ctx, 'admin_groups_default_tag')}` : ''}`,
      inline: true,
      emphasizeValue: true,
    },
    sections: [
      {
        title: t(ctx, 'admin_groups_pricing_section'),
        fields: [
          {
            label: t(ctx, 'admin_groups_badge_label'),
            value: group.badge ? escapeTelegramMarkdown(group.badge) : t(ctx, 'admin_unset_value'),
          },
          {
            label: t(ctx, 'admin_groups_discount_label'),
            value: `${localizedNumber(group.discountPercent, ctx)}%`,
          },
          {
            label: t(ctx, 'admin_groups_flag_custom_vol_discount'),
            value: onOff(group.applyDiscountToCustomVolume),
          },
          {
            label: t(ctx, 'admin_groups_custom_gb_label'),
            value:
              group.customPricePerGb !== null
                ? `${localizedNumber(group.customPricePerGb, ctx)} ${currency}`
                : t(ctx, 'admin_groups_inherit_default'),
          },
          {
            label: t(ctx, 'admin_groups_custom_day_label'),
            value:
              group.customPricePerDay !== null
                ? `${localizedNumber(group.customPricePerDay, ctx)} ${currency}`
                : t(ctx, 'admin_groups_inherit_default'),
          },
          {
            label: t(ctx, 'admin_groups_credit_limit_label'),
            value: `${localizedNumber(group.creditLimit, ctx)} ${currency}`,
          },
        ],
      },
      {
        title: t(ctx, 'admin_groups_flags_section'),
        fields: [
          {
            label: t(ctx, 'admin_groups_flag_catalog'),
            value: onOff(group.allowCatalogDiscounts),
          },
          {
            label: t(ctx, 'admin_groups_flag_promo'),
            value: onOff(group.allowPromoCodes),
          },
          {
            label: t(ctx, 'admin_groups_flag_cashback'),
            value: onOff(group.allowCashback),
          },
          {
            label: t(ctx, 'admin_groups_flag_wheel'),
            value: onOff(group.allowLuckyWheel),
          },
          {
            label: t(ctx, 'admin_groups_flag_custom_name'),
            value: onOff(group.allowCustomServiceName),
          },
        ],
      },
    ],
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

async function renderAdminGroupDeleteTransferPicker(
  ctx: MenuContext,
  groupId: string
): Promise<void> {
  if (!ctx.services?.userGroupService) return;
  const groups = await ctx.services.userGroupService.listGroupsWithMemberCounts();
  const group = groups.find((g) => g.id === groupId);
  if (!group) {
    await renderAdminGroupsList(ctx, { tone: 'warning', text: t(ctx, 'admin_groups_not_found') });
    return;
  }

  const otherGroups = groups.filter((g) => g.id !== groupId);
  if (ctx.session) {
    ctx.session.adminDraft = {
      ...(ctx.session.adminDraft ?? {}),
      activeGroupId: groupId,
      deleteTransferIds: otherGroups.map((g) => g.id),
    };
  }

  const kb = new InlineKeyboard();
  for (const [idx, target] of otherGroups.entries()) {
    kb.text(
      t(ctx, 'admin_groups_delete_transfer_to', { name: target.name }),
      `adm:grp:dt:${idx}`
    ).row();
  }
  kb.text(t(ctx, 'admin_groups_delete_transfer_none'), 'adm:grp:dt:none').row();
  kb.text(t(ctx, 'menu_cancel'), 'adm:grp:va');

  const text = buildAdminScreen({
    emoji: '🗑️',
    title: t(ctx, 'admin_groups_delete_title'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_home_title'),
      t(ctx, 'admin_groups_title'),
      escapeTelegramMarkdown(group.name)
    ),
    primary: {
      label: t(ctx, 'admin_groups_members_label'),
      value: localizedNumber(group.memberCount, ctx),
      inline: true,
    },
    footer: `⚠️ ${t(ctx, 'admin_groups_delete_transfer_prompt')}`,
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

function getActiveGroupId(ctx: MenuContext): string | null {
  const id = ctx.session?.adminDraft?.activeGroupId;
  return typeof id === 'string' && id.trim().length > 0 ? id.trim() : null;
}

function parseNonNegativeSafeInt(raw: string): number | null {
  const normalized = normalizeInputDigits(raw);
  if (!/^\d+$/u.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function registerGroupInputHandlers(): void {
  registerAdminInputHandler('grp:create', async (ctx, text) => {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > MAX_USER_GROUP_NAME_LENGTH) {
      return {
        status: 'retry',
        promptText: buildAdminPromptScreen(
          '➕',
          t(ctx, 'admin_groups_create_title'),
          t(ctx, 'admin_groups_name_prompt'),
          { error: t(ctx, 'admin_groups_invalid_name') }
        ),
      };
    }
    try {
      const created = await ctx.services!.userGroupService!.createGroup(
        { name: trimmed },
        ctx.from?.id
      );
      if (ctx.session) {
        ctx.session.adminDraft = { ...(ctx.session.adminDraft ?? {}), activeGroupId: created.id };
      }
      return {
        status: 'done',
        redirectRoute: 'adm:grp:va',
        notice: { tone: 'success', text: t(ctx, 'admin_groups_created_notice') },
      };
    } catch {
      return {
        status: 'done',
        redirectRoute: 'adm:grp:l',
        notice: { tone: 'error', text: t(ctx, 'operation_failed') },
      };
    }
  });

  registerAdminInputHandler('grp:edit', async (ctx, rawText, state: AdminInputState) => {
    const groupId = typeof state.payload?.groupId === 'string' ? state.payload.groupId : null;
    const field =
      typeof state.payload?.field === 'string' ? (state.payload.field as EditField) : null;
    if (!groupId || !field || !ctx.services?.userGroupService) {
      return { status: 'done', redirectRoute: 'adm:grp:l' };
    }

    const trimmed = rawText.trim();
    const clearRequested = trimmed === '-' || trimmed.toLowerCase() === 'clear';

    const retry = (errKey: string, promptKey: string) => ({
      status: 'retry' as const,
      promptText: buildAdminPromptScreen('✏️', t(ctx, 'admin_groups_title'), t(ctx, promptKey), {
        error: t(ctx, errKey),
      }),
    });

    try {
      if (field === 'name') {
        if (!trimmed || trimmed.length > MAX_USER_GROUP_NAME_LENGTH) {
          return retry('admin_groups_invalid_name', 'admin_groups_name_prompt');
        }
        await ctx.services.userGroupService.updateGroup(groupId, { name: trimmed }, ctx.from?.id);
      } else if (field === 'badge') {
        const badgeValue = clearRequested ? null : trimmed;
        if (badgeValue && badgeValue.length > MAX_USER_GROUP_BADGE_LENGTH) {
          return retry('admin_groups_invalid_badge', 'admin_groups_badge_prompt');
        }
        await ctx.services.userGroupService.updateGroup(
          groupId,
          { badge: badgeValue },
          ctx.from?.id
        );
      } else if (field === 'disc') {
        const parsed = parseNonNegativeSafeInt(trimmed);
        if (parsed === null || parsed > MAX_USER_GROUP_DISCOUNT_PERCENT) {
          return retry('admin_groups_invalid_discount', 'admin_groups_discount_prompt');
        }
        await ctx.services.userGroupService.updateGroup(
          groupId,
          { discountPercent: parsed },
          ctx.from?.id
        );
      } else if (field === 'cred') {
        const parsed = parseNonNegativeSafeInt(trimmed);
        if (parsed === null) {
          return retry('admin_groups_invalid_amount', 'admin_groups_credit_prompt');
        }
        await ctx.services.userGroupService.updateGroup(
          groupId,
          { creditLimit: parsed },
          ctx.from?.id
        );
      } else if (field === 'gb') {
        if (clearRequested) {
          await ctx.services.userGroupService.updateGroup(
            groupId,
            { customPricePerGb: null },
            ctx.from?.id
          );
        } else {
          const parsed = parseNonNegativeSafeInt(trimmed);
          if (parsed === null) {
            return retry('admin_groups_invalid_amount', 'admin_groups_custom_gb_prompt');
          }
          await ctx.services.userGroupService.updateGroup(
            groupId,
            { customPricePerGb: parsed },
            ctx.from?.id
          );
        }
      } else if (field === 'day') {
        if (clearRequested) {
          await ctx.services.userGroupService.updateGroup(
            groupId,
            { customPricePerDay: null },
            ctx.from?.id
          );
        } else {
          const parsed = parseNonNegativeSafeInt(trimmed);
          if (parsed === null) {
            return retry('admin_groups_invalid_amount', 'admin_groups_custom_day_prompt');
          }
          await ctx.services.userGroupService.updateGroup(
            groupId,
            { customPricePerDay: parsed },
            ctx.from?.id
          );
        }
      }

      if (ctx.session) {
        ctx.session.adminDraft = { ...(ctx.session.adminDraft ?? {}), activeGroupId: groupId };
      }
      return {
        status: 'done',
        redirectRoute: 'adm:grp:va',
        notice: { tone: 'success', text: t(ctx, 'admin_setting_saved_title') },
      };
    } catch {
      return {
        status: 'done',
        redirectRoute: 'adm:grp:va',
        notice: { tone: 'error', text: t(ctx, 'operation_failed') },
      };
    }
  });
}

export function registerAdminGroupRoutes(): void {
  registerGroupInputHandlers();

  registerAdminRoute('adm:grp:l', async (ctx, _match, notice) => {
    await renderAdminGroupsList(ctx, notice);
  });

  registerAdminRoute('adm:grp:va', async (ctx, _match, notice) => {
    const activeId = getActiveGroupId(ctx);
    if (!activeId) {
      await renderAdminGroupsList(ctx, notice);
      return;
    }
    await renderAdminGroupDetail(ctx, activeId, notice);
  });

  registerAdminRoute(/^adm:grp:vi:(\d+)$/u, async (ctx, match, notice) => {
    const idx = Number(match?.[1]);
    const list = Array.isArray(ctx.session?.adminDraft?.groupIds)
      ? (ctx.session.adminDraft.groupIds as string[])
      : [];
    const groupId = Number.isSafeInteger(idx) ? list[idx] : undefined;
    if (!groupId) {
      await renderAdminGroupsList(ctx);
      return;
    }
    await renderAdminGroupDetail(ctx, groupId, notice);
  });

  registerAdminRoute('adm:grp:new', async (ctx) => {
    await startAdminInput(ctx, {
      kind: 'grp:create',
      returnRoute: 'adm:grp:l',
      promptText: buildAdminPromptScreen(
        '➕',
        t(ctx, 'admin_groups_create_title'),
        t(ctx, 'admin_groups_name_prompt'),
        {
          breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_groups_title')),
        }
      ),
    });
  });

  registerAdminRoute(/^adm:grp:e:(name|badge|disc|gb|day|cred)$/u, async (ctx, match) => {
    const groupId = getActiveGroupId(ctx);
    const field = match?.[1] as EditField | undefined;
    if (!groupId || !field) {
      await renderAdminGroupsList(ctx);
      return;
    }
    const promptKeyMap: Record<EditField, string> = {
      name: 'admin_groups_name_prompt',
      badge: 'admin_groups_badge_prompt',
      disc: 'admin_groups_discount_prompt',
      gb: 'admin_groups_custom_gb_prompt',
      day: 'admin_groups_custom_day_prompt',
      cred: 'admin_groups_credit_prompt',
    };
    await startAdminInput(ctx, {
      kind: 'grp:edit',
      payload: { groupId, field },
      returnRoute: 'adm:grp:va',
      promptText: buildAdminPromptScreen(
        '✏️',
        t(ctx, 'admin_groups_title'),
        t(ctx, promptKeyMap[field]),
        {
          breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_groups_title')),
        }
      ),
    });
  });

  registerAdminRoute(/^adm:grp:t:(cat|prm|cb|whl|nam|cvd)$/u, async (ctx, match) => {
    const groupId = getActiveGroupId(ctx);
    const flag = match?.[1] as ToggleField | undefined;
    if (!groupId || !flag || !ctx.services?.userGroupService) {
      await renderAdminGroupsList(ctx);
      return;
    }
    const group = await ctx.services.userGroupService.getGroupById(groupId);
    if (!group) {
      await renderAdminGroupsList(ctx, { tone: 'warning', text: t(ctx, 'admin_groups_not_found') });
      return;
    }
    const patch =
      flag === 'cat'
        ? { allowCatalogDiscounts: !group.allowCatalogDiscounts }
        : flag === 'prm'
          ? { allowPromoCodes: !group.allowPromoCodes }
          : flag === 'cb'
            ? { allowCashback: !group.allowCashback }
            : flag === 'whl'
              ? { allowLuckyWheel: !group.allowLuckyWheel }
              : flag === 'cvd'
                ? { applyDiscountToCustomVolume: !group.applyDiscountToCustomVolume }
                : { allowCustomServiceName: !group.allowCustomServiceName };
    await ctx.services.userGroupService.updateGroup(groupId, patch, ctx.from?.id);
    await renderAdminGroupDetail(ctx, groupId, {
      tone: 'success',
      text: t(ctx, 'admin_setting_saved_title'),
    });
  });

  registerAdminRoute('adm:grp:def', async (ctx) => {
    const groupId = getActiveGroupId(ctx);
    if (!groupId || !ctx.services?.userGroupService) {
      await renderAdminGroupsList(ctx);
      return;
    }
    await ctx.services.userGroupService.setDefaultGroup(groupId, ctx.from?.id);
    await renderAdminGroupDetail(ctx, groupId, {
      tone: 'success',
      text: t(ctx, 'admin_groups_default_updated'),
    });
  });

  registerAdminRoute('adm:grp:del', async (ctx) => {
    const groupId = getActiveGroupId(ctx);
    if (!groupId) {
      await renderAdminGroupsList(ctx);
      return;
    }
    await renderAdminGroupDeleteTransferPicker(ctx, groupId);
  });

  registerAdminRoute(/^adm:grp:dt:(\d+|none)$/u, async (ctx, match) => {
    const groupId = getActiveGroupId(ctx);
    if (!groupId || !ctx.services?.userGroupService) {
      await renderAdminGroupsList(ctx);
      return;
    }
    const rawTarget = match?.[1];
    let targetGroupId: string | null = null;
    let targetLabel = t(ctx, 'admin_groups_delete_transfer_none');
    if (rawTarget && rawTarget !== 'none') {
      const idx = Number(rawTarget);
      const ids = Array.isArray(ctx.session?.adminDraft?.deleteTransferIds)
        ? (ctx.session.adminDraft.deleteTransferIds as string[])
        : [];
      targetGroupId = Number.isSafeInteger(idx) ? (ids[idx] ?? null) : null;
      if (targetGroupId) {
        const targetGroup = await ctx.services.userGroupService.getGroupById(targetGroupId);
        if (targetGroup) targetLabel = targetGroup.name;
      }
    }
    if (ctx.session) {
      ctx.session.adminDraft = {
        ...(ctx.session.adminDraft ?? {}),
        deleteTargetGroupId: targetGroupId,
      };
    }

    const group = await ctx.services.userGroupService.getGroupById(groupId);
    if (!group) {
      await renderAdminGroupsList(ctx, { tone: 'warning', text: t(ctx, 'admin_groups_not_found') });
      return;
    }

    const text = buildAdminScreen({
      emoji: '🗑️',
      title: t(ctx, 'admin_groups_delete_title'),
      breadcrumb: buildBreadcrumb(
        t(ctx, 'admin_home_title'),
        t(ctx, 'admin_groups_title'),
        escapeTelegramMarkdown(group.name)
      ),
      primary: {
        label: t(ctx, 'admin_groups_delete_target_label'),
        value: escapeTelegramMarkdown(targetLabel),
        inline: true,
      },
      footer: `⚠️ ${t(ctx, 'admin_groups_delete_confirm_hint', { name: escapeTelegramMarkdown(group.name) })}`,
    });

    await renderScreen(ctx, text, {
      parse_mode: 'Markdown',
      reply_markup: buildAdminConfirmKeyboard(ctx, {
        confirmCallback: 'adm:grp:delok',
        cancelCallback: 'adm:grp:va',
      }),
    });
  });

  registerAdminRoute('adm:grp:delok', async (ctx) => {
    const groupId = getActiveGroupId(ctx);
    if (!groupId || !ctx.services?.userGroupService) {
      await renderAdminGroupsList(ctx);
      return;
    }
    const rawTarget = ctx.session?.adminDraft?.deleteTargetGroupId;
    const transferToGroupId = typeof rawTarget === 'string' ? rawTarget : null;
    try {
      const res = await ctx.services.userGroupService.deleteGroup(groupId, {
        transferToGroupId,
        actorAdminId: ctx.from?.id,
      });
      await renderAdminGroupsList(ctx, {
        tone: res.deleted ? 'success' : 'warning',
        text: res.deleted
          ? t(ctx, 'admin_groups_deleted_notice', {
              count: localizedNumber(res.transferredCount, ctx),
            })
          : t(ctx, 'admin_groups_not_found'),
      });
    } catch {
      await renderAdminGroupDetail(ctx, groupId, {
        tone: 'error',
        text: t(ctx, 'operation_failed'),
      });
    }
  });
}
