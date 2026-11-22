import { InlineKeyboard, type Bot } from 'grammy';
import type { AdminPromoListFilter, MenuContext } from '../../types.js';
import { localizedNumber, normalizeInputDigits, t } from '../../locale.js';
import {
  buildAdminEmptyState,
  buildAdminPromptScreen,
  buildAdminScreen,
  buildBreadcrumb,
  guardAdminCallbacks,
  type AdminScreenNotice,
} from '../../ui.js';
import { escapeTelegramMarkdown, sanitizeTelegramInlineCode } from '../../rendering.js';
import {
  formatPromoValue,
  promoCenterKeyboard,
  promoDeleteConfirmKeyboard,
  promoDetailView,
  renderPromoScreen,
  showPromoCenter,
  showPromoQuickEditor,
  showPromoRedemptions,
} from '../../promoAdminUi.js';
import { appendAdminFooterNav } from '../../admin/adminNav.js';
import { registerAdminRoute } from '../../admin/adminRouter.js';
import {
  adminInputCancelKeyboard,
  registerAdminInputHandler,
  startAdminInput,
} from '../../admin/adminInput.js';

const UUID_CAPTURE = '([0-9a-fA-F-]{36})';
const VALID_PROMO_FILTERS = new Set<AdminPromoListFilter>(['all', 'active', 'inactive', 'expired']);

async function persistPromoPatch(
  ctx: MenuContext,
  id: string,
  patch: Partial<{
    value: number;
    maxUses: number;
    maxUsesPerUser: number;
    minPurchaseAmount: number;
    maxDiscountAmount: number | null;
    firstPurchaseOnly: boolean;
    expiresAt: Date | null;
  }>
): Promise<boolean> {
  if (!ctx.services) return false;
  const promo = await ctx.services.promoService.getPromoCodeById(id);
  if (!promo) return false;
  const wasActive = promo.active;
  await ctx.services.promoService.createPromoCode({
    code: promo.code,
    type: promo.type as 'discount_percent' | 'discount_fixed' | 'gift_credit' | 'gift_gb',
    value: patch.value ?? promo.value,
    maxUses: patch.maxUses ?? promo.maxUses,
    maxUsesPerUser: patch.maxUsesPerUser ?? promo.maxUsesPerUser,
    minPurchaseAmount: patch.minPurchaseAmount ?? promo.minPurchaseAmount,
    maxDiscountAmount:
      patch.maxDiscountAmount !== undefined ? patch.maxDiscountAmount : promo.maxDiscountAmount,
    firstPurchaseOnly: patch.firstPurchaseOnly ?? promo.firstPurchaseOnly,
    expiresAt: patch.expiresAt !== undefined ? patch.expiresAt : promo.expiresAt,
  });
  if (!wasActive) {
    await ctx.services.promoService.setPromoActiveById(promo.id, false);
  }
  return true;
}

export function registerPromoAdminRoutes(bot: Bot<MenuContext>): void {
  const adminCallback = guardAdminCallbacks(bot);

  async function renderDetail(
    ctx: MenuContext,
    id: string,
    notice?: AdminScreenNotice
  ): Promise<void> {
    const view = await promoDetailView(ctx, id, notice);
    if (!view) {
      await renderPromoScreen(
        ctx,
        buildAdminEmptyState(
          '⚠️',
          t(ctx, 'admin_promo_center_title'),
          t(ctx, 'admin_promo_not_found')
        ),
        promoCenterKeyboard(ctx),
        'Markdown'
      );
      return;
    }
    await renderPromoScreen(ctx, view.text, view.keyboard, 'Markdown');
  }

  // ── Unified `adm:prm:*` stateless routes & non-blocking inputs ──────────────

  registerAdminRoute(/^adm:prm:p:(\d+)$/u, async (ctx, match, notice) => {
    await showPromoCenter(ctx, Number(match?.[1]) || 1, { notice });
  });

  registerAdminRoute(/^adm:prm:f:(all|active|inactive|expired)$/u, async (ctx, match, notice) => {
    const raw = match?.[1] as AdminPromoListFilter | undefined;
    const filter: AdminPromoListFilter = raw && VALID_PROMO_FILTERS.has(raw) ? raw : 'all';
    await showPromoCenter(ctx, 1, { filter, notice });
  });

  registerAdminRoute(new RegExp(`^adm:prm:v:${UUID_CAPTURE}$`, 'u'), async (ctx, match, notice) => {
    await renderDetail(ctx, match![1]!, notice);
  });

  registerAdminRoute(
    new RegExp(`^adm:prm:edit:${UUID_CAPTURE}$`, 'u'),
    async (ctx, match, notice) => {
      await showPromoQuickEditor(ctx, match![1]!, notice);
    }
  );

  registerAdminRoute(
    new RegExp(`^adm:prm:red:${UUID_CAPTURE}:(\\d+)$`, 'u'),
    async (ctx, match) => {
      await showPromoRedemptions(ctx, match![1]!, Number(match?.[2]) || 1);
    }
  );

  registerAdminRoute('adm:prm:search', async (ctx) => {
    const page = ctx.session?.adminPromoView?.page ?? 1;
    await startAdminInput(ctx, {
      kind: 'prm:search',
      returnRoute: `adm:prm:p:${page}`,
      promptText: buildAdminPromptScreen({
        emoji: '🔎',
        title: t(ctx, 'admin_promo_center_title'),
        breadcrumb: buildBreadcrumb(
          t(ctx, 'admin_sales_title'),
          t(ctx, 'admin_promo_center_title')
        ),
        body: t(ctx, 'admin_promo_search_prompt'),
      }),
    });
  });

  registerAdminInputHandler('prm:search', async (ctx, text) => {
    if (!ctx.services) return { status: 'done' };
    const query = text.trim();
    const result = await ctx.services.promoService.listCodes(1, 10, query);
    const savedPage = ctx.session?.adminPromoView?.page ?? 1;
    if (result.items.length === 0) {
      const kb = new InlineKeyboard()
        .text(t(ctx, 'admin_promo_search_button'), 'adm:prm:search')
        .row();
      appendAdminFooterNav(kb, ctx, {
        backCallback: `adm:prm:p:${savedPage}`,
        backLabel: t(ctx, 'admin_promo_back_to_list'),
        showHome: true,
      });
      await renderPromoScreen(
        ctx,
        buildAdminEmptyState(
          '📭',
          t(ctx, 'admin_promo_center_title'),
          t(ctx, 'admin_no_promo_codes')
        ),
        kb,
        'Markdown'
      );
      return { status: 'handled' };
    }

    const kb = new InlineKeyboard();
    for (const promo of result.items) {
      kb.text(
        `${promo.active ? '🟢' : '⚪'} ${promo.code} · ${formatPromoValue(ctx, promo)}`,
        `adm:prm:v:${promo.id}`
      ).row();
    }
    kb.text(t(ctx, 'admin_promo_search_button'), 'adm:prm:search').row();
    appendAdminFooterNav(kb, ctx, {
      backCallback: `adm:prm:p:${savedPage}`,
      backLabel: t(ctx, 'admin_promo_back_to_list'),
      showHome: true,
    });

    await renderPromoScreen(
      ctx,
      buildAdminScreen({
        emoji: '🔎',
        title: t(ctx, 'admin_promo_center_title'),
        subtitle: t(ctx, 'admin_promo_search_results', {
          count: localizedNumber(result.total, ctx),
        }),
        sections: [
          {
            fields: result.items.map((promo) => ({
              label: `${promo.active ? '🟢' : '⚪'} ${escapeTelegramMarkdown(promo.code)}`,
              value: `${localizedNumber(promo.currentUses, ctx)} / ${localizedNumber(promo.maxUses, ctx)}`,
            })),
          },
        ],
      }),
      kb,
      'Markdown'
    );
    return { status: 'handled' };
  });

  // 1-tap toggle first-purchase-only inside quick editor
  registerAdminRoute(new RegExp(`^adm:prm:fp:${UUID_CAPTURE}$`, 'u'), async (ctx, match) => {
    if (!ctx.services) return;
    const id = match![1]!;
    const promo = await ctx.services.promoService.getPromoCodeById(id);
    if (!promo) {
      await showPromoCenter(ctx, 1, {
        notice: { tone: 'warning', text: t(ctx, 'admin_promo_not_found') },
      });
      return;
    }
    await persistPromoPatch(ctx, id, { firstPurchaseOnly: !promo.firstPurchaseOnly });
    await showPromoQuickEditor(ctx, id, {
      tone: 'success',
      text: t(ctx, 'admin_promo_saved_notice'),
    });
  });

  // 1-tap preset buttons for quick editor (expiry presets & no-cap)
  registerAdminRoute(
    new RegExp(`^adm:prm:ep:(7d|30d|90d|never|nocap):${UUID_CAPTURE}$`, 'u'),
    async (ctx, match) => {
      const preset = match![1]!;
      const id = match![2]!;
      try {
        if (preset === 'nocap') {
          await persistPromoPatch(ctx, id, { maxDiscountAmount: null });
        } else if (preset === 'never') {
          await persistPromoPatch(ctx, id, { expiresAt: null });
        } else {
          const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90;
          await persistPromoPatch(ctx, id, {
            expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
          });
        }
        await showPromoQuickEditor(ctx, id, {
          tone: 'success',
          text: t(ctx, 'admin_promo_saved_notice'),
        });
      } catch {
        await showPromoQuickEditor(ctx, id, {
          tone: 'error',
          text: t(ctx, 'operation_failed'),
        });
      }
    }
  );

  // Field edit prompts via non-blocking adminInput
  registerAdminRoute(
    new RegExp(`^adm:prm:ef:(val|max|usr|min|cap|exp):${UUID_CAPTURE}$`, 'u'),
    async (ctx, match) => {
      if (!ctx.services) return;
      const field = match![1]!;
      const id = match![2]!;
      const promo = await ctx.services.promoService.getPromoCodeById(id);
      if (!promo) {
        await showPromoCenter(ctx, 1, {
          notice: { tone: 'warning', text: t(ctx, 'admin_promo_not_found') },
        });
        return;
      }

      const promptKeyMap: Record<string, string> = {
        val: 'admin_promo_value_prompt',
        max: 'admin_promo_max_uses_prompt',
        usr: 'admin_promo_per_user_prompt',
        min: 'admin_promo_min_purchase_prompt',
        cap: 'admin_promo_max_discount_prompt',
        exp: 'admin_promo_expiry_prompt',
      };

      const keyboard = adminInputCancelKeyboard(ctx, (kb) => {
        if (field === 'cap') {
          kb.text(t(ctx, 'admin_promo_preset_no_cap'), `adm:prm:ep:nocap:${id}`).row();
        } else if (field === 'exp') {
          kb.text(t(ctx, 'admin_promo_preset_7d'), `adm:prm:ep:7d:${id}`)
            .text(t(ctx, 'admin_promo_preset_30d'), `adm:prm:ep:30d:${id}`)
            .row()
            .text(t(ctx, 'admin_promo_preset_90d'), `adm:prm:ep:90d:${id}`)
            .text(t(ctx, 'admin_promo_preset_never'), `adm:prm:ep:never:${id}`)
            .row();
        }
      });

      await startAdminInput(ctx, {
        kind: 'prm:edit_field',
        payload: { id, field },
        returnRoute: `adm:prm:edit:${id}`,
        promptText: buildAdminPromptScreen({
          emoji: '✏️',
          title: t(ctx, 'admin_promo_edit_field_title'),
          subtitle: `\`${sanitizeTelegramInlineCode(promo.code)}\``,
          body: t(ctx, promptKeyMap[field]!),
        }),
        keyboard,
      });
    }
  );

  registerAdminInputHandler('prm:edit_field', async (ctx, rawText, state) => {
    if (!ctx.services) return { status: 'done' };
    const id = String(state.payload?.id ?? '');
    const field = String(state.payload?.field ?? '');
    const promo = await ctx.services.promoService.getPromoCodeById(id);
    if (!promo) {
      return {
        status: 'done',
        redirectRoute: 'adm:prm:p:1',
        notice: { tone: 'warning', text: t(ctx, 'admin_promo_not_found') },
      };
    }

    const raw = rawText.trim().toLowerCase();
    const normalized = normalizeInputDigits(raw);
    const makeRetry = (errorKey: string) => ({
      status: 'retry' as const,
      promptText: buildAdminPromptScreen({
        emoji: '✏️',
        title: t(ctx, 'admin_promo_edit_field_title'),
        subtitle: `\`${sanitizeTelegramInlineCode(promo.code)}\``,
        body: t(ctx, errorKey),
        error: t(ctx, errorKey),
      }),
    });

    try {
      if (field === 'val') {
        const parsed = /^\d+$/u.test(normalized) ? Number(normalized) : NaN;
        const max = promo.type === 'discount_percent' ? 100 : 2_147_483_647;
        if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
          return makeRetry('admin_invalid_promo_value');
        }
        await persistPromoPatch(ctx, id, { value: parsed });
      } else if (field === 'max') {
        const parsed = /^\d+$/u.test(normalized) ? Number(normalized) : NaN;
        if (
          !Number.isSafeInteger(parsed) ||
          parsed < Math.max(1, promo.currentUses) ||
          parsed > 2_147_483_647
        ) {
          return makeRetry('admin_invalid_promo_max_uses');
        }
        await persistPromoPatch(ctx, id, { maxUses: parsed });
      } else if (field === 'usr') {
        const parsed = /^\d+$/u.test(normalized) ? Number(normalized) : NaN;
        if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > promo.maxUses) {
          return makeRetry('admin_invalid_promo_per_user');
        }
        await persistPromoPatch(ctx, id, { maxUsesPerUser: parsed });
      } else if (field === 'min') {
        const parsed = /^\d+$/u.test(normalized) ? Number(normalized) : NaN;
        if (!Number.isSafeInteger(parsed) || parsed < 0) {
          return makeRetry('admin_invalid_promo_min_purchase');
        }
        await persistPromoPatch(ctx, id, { minPurchaseAmount: parsed });
      } else if (field === 'cap') {
        if (['0', 'none', 'بدون', 'no'].includes(normalized)) {
          await persistPromoPatch(ctx, id, { maxDiscountAmount: null });
        } else {
          const parsed = /^\d+$/u.test(normalized) ? Number(normalized) : NaN;
          if (!Number.isSafeInteger(parsed) || parsed < 0) {
            return makeRetry('admin_promo_invalid_max_discount');
          }
          await persistPromoPatch(ctx, id, { maxDiscountAmount: parsed === 0 ? null : parsed });
        }
      } else if (field === 'exp') {
        if (['0', 'never', 'none', 'بدون'].includes(normalized)) {
          await persistPromoPatch(ctx, id, { expiresAt: null });
        } else if (/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) {
          const date = new Date(`${normalized}T23:59:59.999Z`);
          if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
            return makeRetry('admin_invalid_promo_expiry');
          }
          await persistPromoPatch(ctx, id, { expiresAt: date });
        } else {
          return makeRetry('admin_invalid_promo_expiry');
        }
      }
      return {
        status: 'done',
        redirectRoute: `adm:prm:edit:${id}`,
        notice: { tone: 'success', text: t(ctx, 'admin_promo_saved_notice') },
      };
    } catch {
      return {
        status: 'done',
        redirectRoute: `adm:prm:edit:${id}`,
        notice: { tone: 'error', text: t(ctx, 'operation_failed') },
      };
    }
  });

  // ── Backward-compatible `promo:*` routes ────────────────────────────────────

  adminCallback('promo:list', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showPromoCenter(ctx, 1);
  });

  adminCallback(/^promo:page:(\d+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showPromoCenter(ctx, Number(ctx.match[1]) || 1);
  });

  adminCallback('promo:create', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('adminCreatePromoConversation');
  });

  adminCallback('promo:bulk', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('adminBulkPromoConversation');
  });

  adminCallback('promo:search', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('adminSearchPromoConversation');
  });

  adminCallback(new RegExp(`^promo:redemptions:${UUID_CAPTURE}:(\\d+)$`, 'u'), async (ctx) => {
    await ctx.answerCallbackQuery();
    await showPromoRedemptions(ctx, ctx.match[1]!, Number(ctx.match[2]) || 1);
  });

  adminCallback(new RegExp(`^promo:open:${UUID_CAPTURE}$`, 'u'), async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderDetail(ctx, ctx.match[1]!);
  });

  adminCallback(new RegExp(`^promo:edit:${UUID_CAPTURE}$`, 'u'), async (ctx) => {
    ctx.session.adminPromoEditId = ctx.match[1]!;
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('adminEditPromoConversation');
  });

  adminCallback(new RegExp(`^promo:set:([01]):${UUID_CAPTURE}$`, 'u'), async (ctx) => {
    if (!ctx.services) return;
    const active = ctx.match[1] === '1';
    const id = ctx.match[2]!;
    const promo = await ctx.services.promoService.getPromoCodeById(id);
    if (!promo) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'admin_promo_not_found'), show_alert: true });
      return;
    }
    const updated = await ctx.services.promoService.setPromoActiveById(id, active);
    const toast = t(ctx, updated ? 'admin_promo_toggled' : 'operation_failed', {
      code: promo.code,
      active: t(ctx, active ? 'admin_promo_active' : 'admin_promo_inactive'),
    }).replaceAll('`', '');
    await ctx.answerCallbackQuery({ text: toast });
    if (updated) await renderDetail(ctx, id);
  });

  // A pre-upgrade toggle does not encode the intended state. Refresh it
  // instead of risking an inverse mutation from a stale or repeated click.
  adminCallback(new RegExp(`^promo:toggle:${UUID_CAPTURE}$`, 'u'), async (ctx) => {
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await renderDetail(ctx, ctx.match[1]!);
  });

  adminCallback(new RegExp(`^promo:delete:${UUID_CAPTURE}$`, 'u'), async (ctx) => {
    if (!ctx.services) return;
    const id = ctx.match[1]!;
    const promo = await ctx.services.promoService.getPromoCodeById(id);
    if (!promo) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'admin_promo_not_found'), show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await renderPromoScreen(
      ctx,
      buildAdminScreen({
        emoji: '🗑️',
        title: t(ctx, 'admin_promo_delete_title'),
        subtitle: t(ctx, 'admin_promo_delete_subtitle'),
        primary: {
          emoji: '🎟️',
          label: t(ctx, 'checkout_promo_section'),
          value: `\`${sanitizeTelegramInlineCode(promo.code)}\``,
          inline: true,
        },
        footer: `⚠️ ${t(ctx, 'admin_promo_delete_consequence')}`,
      }),
      promoDeleteConfirmKeyboard(ctx, id),
      'Markdown'
    );
  });

  adminCallback(new RegExp(`^promo:delete_confirm:${UUID_CAPTURE}$`, 'u'), async (ctx) => {
    if (!ctx.services) return;
    const id = ctx.match[1]!;
    const promo = await ctx.services.promoService.getPromoCodeById(id);
    const deleted = promo ? await ctx.services.promoService.deletePromoCodeById(id) : false;
    await ctx.answerCallbackQuery({
      text: t(ctx, deleted ? 'admin_promo_deleted' : 'admin_promo_delete_failed', {
        code: promo?.code ?? '—',
      }).replaceAll('`', ''),
      show_alert: !deleted,
    });
    if (deleted) {
      await showPromoCenter(ctx, 1);
    } else if (promo) {
      await renderDetail(ctx, id, {
        tone: 'error',
        text: t(ctx, 'admin_promo_delete_failed', { code: promo.code }),
      });
    } else {
      await showPromoCenter(ctx, 1);
    }
  });

  // Old session-token buttons and future unknown promo actions fail visibly.
  adminCallback(/^promo:/u, async (ctx) => {
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_promo_stale_button'), show_alert: true });
    await showPromoCenter(ctx, 1);
  });
}
