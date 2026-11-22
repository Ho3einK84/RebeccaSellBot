/**
 * Stateless Admin routes for automated wallet payment gateways:
 *  - `adm:pg:fa*` — ForApp automated bank SMS verification & unmatched deposits queue
 *  - `adm:pg:np*` — NOWPayments crypto gateway configuration & connection diagnostics
 *
 * Security: All gateway secret inputs (NOWPayments API Key & IPN Secret) use one-shot
 * non-blocking `startAdminInput` handlers whose middleware deletes the admin's message
 * immediately and never passes secrets through grammY Conversation replay storage.
 */
import { InlineKeyboard } from 'grammy';
import {
  AutomatedPaymentError,
  formatPaymentOrderShortId,
} from '../../domain/services/AutomatedPaymentService.js';
import { localizedDateTime, localizedNumber, normalizeInputDigits, t } from '../locale.js';
import { escapeTelegramMarkdown, sanitizeTelegramInlineCode } from '../rendering.js';
import {
  buildAdminEmptyState,
  buildAdminPromptScreen,
  buildAdminScreen,
  buildBreadcrumb,
  buildStatusBadge,
  rememberArtifactMessage,
  renderScreen,
  type AdminScreenNotice,
} from '../ui.js';
import type { MenuContext } from '../types.js';
import { appendAdminFooterNav, appendAdminPagination, markAdminContext } from './adminNav.js';
import { registerAdminRoute } from './adminRouter.js';
import {
  adminInputCancelKeyboard,
  registerAdminInputHandler,
  startAdminInput,
} from './adminInput.js';
import { truncateButtonLabel } from '../conversations/adminConversations/settings/presentation.js';
import { sendAutomatedTopupSuccessNotification } from '../features/admin/adminNotifications.js';

const DEPOSITS_PAGE_SIZE = 5;
const FORAPP_GITHUB_URL = 'https://github.com/erfjab/forapp';

function parseBoundedInt(raw: string, min: number, max: number): number | null {
  const cleaned = normalizeInputDigits(raw)
    .replace(/[,_،٬\s]/gu, '')
    .trim();
  if (!/^\d+$/u.test(cleaned)) return null;
  const num = Number(cleaned);
  if (!Number.isSafeInteger(num) || num < min || num > max) return null;
  return num;
}

// ── 1. ForApp Automated Card-to-Card (`adm:pg:fa`) ───────────────────────────

export async function renderForAppSettingsScreen(
  ctx: MenuContext,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services?.automatedPaymentService) return;
  markAdminContext(ctx);
  const cfg = await ctx.services.automatedPaymentService.getForAppAdminConfig();

  const text = buildAdminScreen({
    emoji: '⚡',
    title: t(ctx, 'admin_forapp_title'),
    subtitle: t(ctx, 'admin_forapp_subtitle'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_menu_settings'),
      t(ctx, 'admin_cfg_payment_button'),
      t(ctx, 'admin_forapp_title')
    ),
    notice,
    primary: {
      emoji: cfg.enabled ? '🟢' : '⚪',
      label: t(ctx, 'admin_forapp_title'),
      value: buildStatusBadge(ctx, cfg.enabled ? 'active' : 'inactive'),
      inline: true,
    },
    sections: [
      {
        emoji: '🔐',
        title: t(ctx, 'admin_forapp_title'),
        fields: [
          {
            label: t(ctx, 'admin_forapp_api_key_label'),
            value: cfg.apiKeyConfigured
              ? `${t(ctx, 'admin_auto_pay_configured')} (\`${sanitizeTelegramInlineCode(cfg.apiKeyMasked ?? '••••')}\`)`
              : t(ctx, 'admin_auto_pay_not_configured'),
          },
          {
            label: t(ctx, 'admin_forapp_webhook_url_label'),
            value: cfg.webhookUrl
              ? `\`${sanitizeTelegramInlineCode(cfg.webhookUrl)}\``
              : t(ctx, 'admin_forapp_webhook_missing_hint'),
          },
          {
            label: t(ctx, 'admin_forapp_expiry_label'),
            value: `${localizedNumber(cfg.orderExpiryMinutes, ctx)} ${t(ctx, 'admin_auto_pay_minutes_unit')}`,
          },
          {
            label: t(ctx, 'admin_forapp_unmatched_label'),
            value: localizedNumber(cfg.unmatchedCount, ctx),
          },
        ],
      },
    ],
    footer: t(ctx, 'admin_forapp_about_short'),
  });

  const unmatchedBadge =
    cfg.unmatchedCount > 0 ? ` (${localizedNumber(cfg.unmatchedCount, ctx)})` : '';

  const kb = new InlineKeyboard()
    .text(
      truncateButtonLabel(`${t(ctx, 'admin_forapp_title')}: ${cfg.enabled ? '🟢' : '⚪'}`),
      'adm:pg:fa:tg'
    )
    .row()
    .text(t(ctx, 'admin_forapp_rotate_key_button'), 'adm:pg:fa:rot')
    .row()
    .text(t(ctx, 'admin_forapp_edit_expiry_button'), 'adm:pg:fa:exp')
    .row()
    .text(`${t(ctx, 'admin_forapp_unmatched_button')}${unmatchedBadge}`, 'adm:pg:fad:1')
    .row()
    .text(t(ctx, 'admin_forapp_guide_button'), 'adm:pg:fa:guide')
    .url(t(ctx, 'admin_forapp_github_button'), FORAPP_GITHUB_URL)
    .row();
  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:cfg:pay',
    backLabel: `‹ ${t(ctx, 'admin_cfg_payment_button')}`,
    showHome: true,
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

export async function renderForAppGuideScreen(ctx: MenuContext): Promise<void> {
  if (!ctx.services?.automatedPaymentService) return;
  markAdminContext(ctx);
  const cfg = await ctx.services.automatedPaymentService.getForAppAdminConfig();

  const text = buildAdminScreen({
    emoji: '📖',
    title: t(ctx, 'admin_forapp_guide_title'),
    subtitle: t(ctx, 'admin_forapp_guide_subtitle'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_cfg_payment_button'),
      t(ctx, 'admin_forapp_title'),
      t(ctx, 'admin_forapp_guide_title')
    ),
    sections: [
      {
        emoji: '💡',
        title: t(ctx, 'admin_forapp_guide_what_title'),
        fields: [{ value: t(ctx, 'admin_forapp_guide_what_body'), bullet: '' }],
      },
      {
        emoji: '🛠️',
        title: t(ctx, 'admin_forapp_guide_steps_title'),
        fields: [{ value: t(ctx, 'admin_forapp_guide_steps_body'), bullet: '' }],
      },
      {
        emoji: '🌐',
        title: t(ctx, 'admin_forapp_webhook_url_label'),
        fields: [
          {
            label: t(ctx, 'admin_forapp_webhook_url_label'),
            value: cfg.webhookUrl
              ? `\`${sanitizeTelegramInlineCode(cfg.webhookUrl)}\``
              : t(ctx, 'admin_forapp_webhook_missing_hint'),
          },
        ],
      },
    ],
  });

  const kb = new InlineKeyboard()
    .url(t(ctx, 'admin_forapp_github_button'), FORAPP_GITHUB_URL)
    .row();
  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:pg:fa',
    backLabel: `‹ ${t(ctx, 'admin_forapp_title')}`,
    showHome: true,
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

// ── 2. ForApp Unmatched Deposits (`adm:pg:fad:*`) ────────────────────────────

export async function renderForAppUnmatchedListScreen(
  ctx: MenuContext,
  page = 1,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services?.automatedPaymentService) return;
  markAdminContext(ctx);
  const res = await ctx.services.automatedPaymentService.listForAppDeposits({
    page,
    pageSize: DEPOSITS_PAGE_SIZE,
    status: 'unmatched',
  });
  const currency = t(ctx, 'currency_toman');
  const rialUnit = t(ctx, 'currency_rial');

  if (res.items.length === 0) {
    const kb = new InlineKeyboard();
    appendAdminFooterNav(kb, ctx, {
      backCallback: 'adm:pg:fa',
      backLabel: `‹ ${t(ctx, 'admin_forapp_title')}`,
      showHome: true,
    });
    await renderScreen(
      ctx,
      buildAdminEmptyState(
        '📥',
        t(ctx, 'admin_forapp_unmatched_title'),
        t(ctx, 'admin_forapp_unmatched_empty')
      ),
      { parse_mode: 'Markdown', reply_markup: kb }
    );
    return;
  }

  const text = buildAdminScreen({
    emoji: '📥',
    title: t(ctx, 'admin_forapp_unmatched_title'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_cfg_payment_button'),
      t(ctx, 'admin_forapp_title'),
      t(ctx, 'admin_forapp_unmatched_title')
    ),
    notice,
    sections: [
      {
        fields: res.items.map((dep) => {
          const amountLabel =
            dep.amountToman !== null
              ? `${localizedNumber(dep.amountToman, ctx)} ${currency}`
              : `${localizedNumber(dep.amountRial, ctx)} ${rialUnit}`;
          return {
            label: `#${formatPaymentOrderShortId(dep.id)}`,
            value: `${amountLabel}${dep.bank ? ` · ${escapeTelegramMarkdown(dep.bank)}` : ''}`,
          };
        }),
      },
    ],
  });

  const kb = new InlineKeyboard();
  for (const dep of res.items) {
    const amountLabel =
      dep.amountToman !== null
        ? `${localizedNumber(dep.amountToman, ctx)} ${currency}`
        : `${localizedNumber(dep.amountRial, ctx)} ${rialUnit}`;
    kb.text(
      truncateButtonLabel(`#${formatPaymentOrderShortId(dep.id)} · ${amountLabel}`),
      `adm:pg:fad:v:${dep.id}`
    ).row();
  }
  appendAdminPagination(kb, ctx, {
    page: res.page,
    totalPages: res.totalPages,
    pageCallback: (p) => `adm:pg:fad:${p}`,
  });
  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:pg:fa',
    backLabel: `‹ ${t(ctx, 'admin_forapp_title')}`,
    showHome: true,
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

export async function renderForAppDepositDetailScreen(
  ctx: MenuContext,
  depositId: string,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services?.automatedPaymentService) return;
  markAdminContext(ctx);
  const dep = await ctx.services.automatedPaymentService.getForAppDepositById(depositId);
  if (!dep) {
    await renderForAppUnmatchedListScreen(ctx, 1, {
      tone: 'warning',
      text: t(ctx, 'admin_forapp_deposit_not_found'),
    });
    return;
  }

  const currency = t(ctx, 'currency_toman');
  const rialUnit = t(ctx, 'currency_rial');
  const fields: Array<{ label: string; value: string }> = [
    {
      label: t(ctx, 'auto_pay_order_id_label'),
      value: `\`#${formatPaymentOrderShortId(dep.id)}\``,
    },
    {
      label: t(ctx, 'forapp_exact_rial_label'),
      value: `${localizedNumber(dep.amountRial, ctx)} ${rialUnit}`,
    },
  ];
  if (dep.bank) {
    fields.push({
      label: t(ctx, 'topup_card_bank_label'),
      value: escapeTelegramMarkdown(dep.bank),
    });
  }
  if (dep.sender) {
    fields.push({
      label: t(ctx, 'admin_forapp_sender_label'),
      value: `\`${sanitizeTelegramInlineCode(dep.sender)}\``,
    });
  }
  fields.push({
    label: t(ctx, 'wallet_pending_submitted'),
    value: localizedDateTime(new Date(dep.receivedAt ?? dep.createdAt), ctx),
  });
  if (dep.rawBody) {
    fields.push({
      label: t(ctx, 'admin_forapp_deposit_sms_label'),
      value: escapeTelegramMarkdown(dep.rawBody.slice(0, 260)),
    });
  }

  const text = buildAdminScreen({
    emoji: '📥',
    title: t(ctx, 'admin_forapp_deposit_detail_title'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_forapp_title'),
      t(ctx, 'admin_forapp_unmatched_title'),
      `#${formatPaymentOrderShortId(dep.id)}`
    ),
    notice,
    primary: {
      emoji: '💰',
      label: t(ctx, 'admin_receipt_amount_label'),
      value:
        dep.amountToman !== null
          ? `${localizedNumber(dep.amountToman, ctx)} ${currency}`
          : `${localizedNumber(dep.amountRial, ctx)} ${rialUnit}`,
      inline: true,
      emphasizeValue: true,
    },
    sections: [{ fields }],
  });

  const kb = new InlineKeyboard();
  if (dep.status === 'unmatched') {
    kb.text(t(ctx, 'admin_forapp_deposit_match_button'), `adm:pg:fad:m:${dep.id}`).row();
    kb.text(t(ctx, 'admin_forapp_deposit_dismiss_button'), `adm:pg:fad:d:${dep.id}`).row();
  }
  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:pg:fad:1',
    backLabel: `‹ ${t(ctx, 'admin_forapp_unmatched_title')}`,
    showHome: true,
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

// ── 3. NOWPayments Crypto Gateway (`adm:pg:np`) ──────────────────────────────

export async function renderNowPaymentsSettingsScreen(
  ctx: MenuContext,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services?.automatedPaymentService) return;
  markAdminContext(ctx);
  const cfg = await ctx.services.automatedPaymentService.getNowPaymentsAdminConfig();
  const currency = t(ctx, 'currency_toman');

  const text = buildAdminScreen({
    emoji: '🪙',
    title: t(ctx, 'admin_nowpayments_title'),
    subtitle: t(ctx, 'admin_nowpayments_subtitle'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_menu_settings'),
      t(ctx, 'admin_cfg_payment_button'),
      t(ctx, 'admin_nowpayments_title')
    ),
    notice,
    primary: {
      emoji: cfg.enabled ? '🟢' : '⚪',
      label: t(ctx, 'admin_nowpayments_title'),
      value: buildStatusBadge(ctx, cfg.enabled ? 'active' : 'inactive'),
      inline: true,
    },
    sections: [
      {
        emoji: '🔐',
        title: t(ctx, 'admin_nowpayments_title'),
        fields: [
          {
            label: t(ctx, 'admin_nowpayments_mode_label'),
            value: cfg.sandbox
              ? t(ctx, 'admin_nowpayments_mode_sandbox')
              : t(ctx, 'admin_nowpayments_mode_prod'),
          },
          {
            label: t(ctx, 'admin_nowpayments_api_key_label'),
            value: cfg.apiKeyConfigured
              ? t(ctx, 'admin_auto_pay_configured')
              : t(ctx, 'admin_auto_pay_not_configured'),
          },
          {
            label: t(ctx, 'admin_nowpayments_ipn_secret_label'),
            value: cfg.ipnSecretConfigured
              ? t(ctx, 'admin_auto_pay_configured')
              : t(ctx, 'admin_auto_pay_not_configured'),
          },
          {
            label: t(ctx, 'admin_forapp_webhook_url_label'),
            value: cfg.webhookUrl
              ? `\`${sanitizeTelegramInlineCode(cfg.webhookUrl)}\``
              : t(ctx, 'admin_forapp_webhook_missing_hint'),
          },
        ],
      },
      {
        emoji: '💱',
        title: t(ctx, 'nowpayments_rate_label'),
        fields: [
          {
            label: t(ctx, 'admin_nowpayments_rate_mode_label'),
            value:
              cfg.rateMode === 'auto'
                ? t(ctx, 'admin_nowpayments_rate_mode_auto')
                : t(ctx, 'admin_nowpayments_rate_mode_manual'),
          },
          {
            label: t(ctx, 'admin_nowpayments_manual_rate_label'),
            value: `${localizedNumber(cfg.manualUsdRateToman, ctx)} ${currency}`,
          },
          {
            label: t(ctx, 'admin_nowpayments_effective_rate_label'),
            value: `${localizedNumber(cfg.effectiveUsdRateToman, ctx)} ${currency} (${cfg.effectiveRateSource})`,
          },
          {
            label: t(ctx, 'admin_nowpayments_limits_label'),
            value: `${localizedNumber(cfg.minAmountToman, ctx)} – ${localizedNumber(cfg.maxAmountToman, ctx)} ${currency}`,
          },
          {
            label: t(ctx, 'admin_nowpayments_cashback_label'),
            value: `${localizedNumber(cfg.cashbackPercent, ctx)}%`,
          },
          {
            label: t(ctx, 'admin_forapp_expiry_label'),
            value: `${localizedNumber(cfg.orderExpiryMinutes, ctx)} ${t(ctx, 'admin_auto_pay_minutes_unit')}`,
          },
        ],
      },
    ],
  });

  const kb = new InlineKeyboard()
    .text(
      truncateButtonLabel(`${t(ctx, 'admin_nowpayments_title')}: ${cfg.enabled ? '🟢' : '⚪'}`),
      'adm:pg:np:tg'
    )
    .text(
      truncateButtonLabel(
        `${t(ctx, 'admin_nowpayments_toggle_sandbox_button')}: ${cfg.sandbox ? '🟡' : '🟢'}`
      ),
      'adm:pg:np:sb'
    )
    .row()
    .text(t(ctx, 'admin_nowpayments_set_api_key_button'), 'adm:pg:np:ed:key')
    .text(t(ctx, 'admin_nowpayments_set_ipn_secret_button'), 'adm:pg:np:ed:ipn')
    .row()
    .text(t(ctx, 'admin_nowpayments_toggle_rate_mode_button'), 'adm:pg:np:rm')
    .text(t(ctx, 'admin_nowpayments_edit_rate_button'), 'adm:pg:np:ed:rate')
    .row()
    .text(t(ctx, 'admin_nowpayments_edit_min_button'), 'adm:pg:np:ed:min')
    .text(t(ctx, 'admin_nowpayments_edit_max_button'), 'adm:pg:np:ed:max')
    .row()
    .text(t(ctx, 'admin_nowpayments_edit_cashback_button'), 'adm:pg:np:ed:cb')
    .text(t(ctx, 'admin_nowpayments_edit_expiry_button'), 'adm:pg:np:ed:exp')
    .row()
    .text(t(ctx, 'admin_nowpayments_test_button'), 'adm:pg:np:test')
    .row();
  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:cfg:pay',
    backLabel: `‹ ${t(ctx, 'admin_cfg_payment_button')}`,
    showHome: true,
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

// ── Route & Input Registration ───────────────────────────────────────────────

export function registerAdminPaymentGatewayRoutes(): void {
  // ForApp routes
  registerAdminRoute('adm:pg:fa', async (ctx, _m, notice) => {
    await renderForAppSettingsScreen(ctx, notice);
  });

  registerAdminRoute('adm:pg:fa:guide', async (ctx) => {
    await renderForAppGuideScreen(ctx);
  });

  registerAdminRoute('adm:pg:fa:tg', async (ctx) => {
    const svc = ctx.services?.automatedPaymentService;
    if (!svc) return;
    const current = await svc.getForAppAdminConfig();
    await svc.updateForAppConfig({ enabled: !current.enabled });
    await renderForAppSettingsScreen(ctx, {
      tone: 'success',
      text: t(ctx, 'admin_auto_pay_saved'),
    });
  });

  registerAdminRoute('adm:pg:fa:rot', async (ctx) => {
    const svc = ctx.services?.automatedPaymentService;
    if (!svc) return;
    const rotated = await svc.rotateForAppApiKey();
    const keyMsg = await ctx.reply(
      buildAdminScreen({
        emoji: '🔑',
        title: t(ctx, 'admin_forapp_key_rotated_title'),
        footer: t(ctx, 'admin_forapp_key_rotated_body', {
          api_key: sanitizeTelegramInlineCode(rotated.apiKey),
          webhook_url: sanitizeTelegramInlineCode(
            rotated.webhookUrl ?? t(ctx, 'admin_forapp_webhook_missing_hint')
          ),
        }),
      }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text(t(ctx, 'menu_close'), 'ui:dismiss'),
      }
    );
    if (ctx.session) {
      rememberArtifactMessage(ctx.session, keyMsg.message_id);
    }
    await renderForAppSettingsScreen(ctx, {
      tone: 'success',
      text: t(ctx, 'admin_forapp_key_rotated_title'),
    });
  });

  registerAdminRoute('adm:pg:fa:exp', async (ctx) => {
    await startAdminInput(ctx, {
      kind: 'pg_fa_exp',
      returnRoute: 'adm:pg:fa',
      promptText: buildAdminPromptScreen({
        emoji: '⏳',
        title: t(ctx, 'admin_forapp_edit_expiry_button'),
        body: t(ctx, 'admin_forapp_expiry_prompt'),
      }),
      keyboard: adminInputCancelKeyboard(ctx),
    });
  });

  registerAdminRoute(/^adm:pg:fad:(\d+)$/u, async (ctx, match, notice) => {
    const page = Number(match?.[1] ?? 1) || 1;
    await renderForAppUnmatchedListScreen(ctx, page, notice);
  });

  registerAdminRoute(/^adm:pg:fad:v:([a-zA-Z0-9_-]+)$/u, async (ctx, match, notice) => {
    const depositId = match?.[1];
    if (!depositId) return;
    await renderForAppDepositDetailScreen(ctx, depositId, notice);
  });

  registerAdminRoute(/^adm:pg:fad:m:([a-zA-Z0-9_-]+)$/u, async (ctx, match) => {
    const depositId = match?.[1];
    if (!depositId) return;
    await startAdminInput(ctx, {
      kind: 'pg_fad_match',
      payload: { depositId },
      returnRoute: `adm:pg:fad:v:${depositId}`,
      promptText: buildAdminPromptScreen({
        emoji: '✅',
        title: t(ctx, 'admin_forapp_deposit_match_button'),
        body: t(ctx, 'admin_forapp_deposit_match_prompt'),
      }),
      keyboard: adminInputCancelKeyboard(ctx),
    });
  });

  registerAdminRoute(/^adm:pg:fad:d:([a-zA-Z0-9_-]+)$/u, async (ctx, match) => {
    const depositId = match?.[1];
    const adminId = ctx.from?.id;
    const svc = ctx.services?.automatedPaymentService;
    if (!depositId || !adminId || !svc) return;
    await svc.dismissForAppDeposit({ depositId, adminId });
    await renderForAppUnmatchedListScreen(ctx, 1, {
      tone: 'info',
      text: t(ctx, 'admin_forapp_deposit_dismissed_notice'),
    });
  });

  // NOWPayments routes
  registerAdminRoute('adm:pg:np', async (ctx, _m, notice) => {
    await renderNowPaymentsSettingsScreen(ctx, notice);
  });

  registerAdminRoute('adm:pg:np:tg', async (ctx) => {
    const svc = ctx.services?.automatedPaymentService;
    if (!svc) return;
    const current = await svc.getNowPaymentsAdminConfig();
    await svc.updateNowPaymentsConfig({ enabled: !current.enabled });
    await renderNowPaymentsSettingsScreen(ctx, {
      tone: 'success',
      text: t(ctx, 'admin_auto_pay_saved'),
    });
  });

  registerAdminRoute('adm:pg:np:sb', async (ctx) => {
    const svc = ctx.services?.automatedPaymentService;
    if (!svc) return;
    const current = await svc.getNowPaymentsAdminConfig();
    await svc.updateNowPaymentsConfig({ sandbox: !current.sandbox });
    await renderNowPaymentsSettingsScreen(ctx, {
      tone: 'success',
      text: t(ctx, 'admin_auto_pay_saved'),
    });
  });

  registerAdminRoute('adm:pg:np:rm', async (ctx) => {
    const svc = ctx.services?.automatedPaymentService;
    if (!svc) return;
    const current = await svc.getNowPaymentsAdminConfig();
    await svc.updateNowPaymentsConfig({
      rateMode: current.rateMode === 'auto' ? 'manual' : 'auto',
    });
    await renderNowPaymentsSettingsScreen(ctx, {
      tone: 'success',
      text: t(ctx, 'admin_auto_pay_saved'),
    });
  });

  registerAdminRoute(/^adm:pg:np:ed:(key|ipn|rate|min|max|cb|exp)$/u, async (ctx, match) => {
    const field = match?.[1] as 'key' | 'ipn' | 'rate' | 'min' | 'max' | 'cb' | 'exp' | undefined;
    if (!field) return;
    const promptKeyMap: Record<typeof field, { title: string; body: string; emoji: string }> = {
      key: {
        emoji: '🔑',
        title: t(ctx, 'admin_nowpayments_set_api_key_button'),
        body: t(ctx, 'admin_nowpayments_api_key_prompt'),
      },
      ipn: {
        emoji: '🔐',
        title: t(ctx, 'admin_nowpayments_set_ipn_secret_button'),
        body: t(ctx, 'admin_nowpayments_ipn_secret_prompt'),
      },
      rate: {
        emoji: '💱',
        title: t(ctx, 'admin_nowpayments_edit_rate_button'),
        body: t(ctx, 'admin_nowpayments_rate_prompt'),
      },
      min: {
        emoji: '📉',
        title: t(ctx, 'admin_nowpayments_edit_min_button'),
        body: t(ctx, 'admin_nowpayments_min_prompt'),
      },
      max: {
        emoji: '📈',
        title: t(ctx, 'admin_nowpayments_edit_max_button'),
        body: t(ctx, 'admin_nowpayments_max_prompt'),
      },
      cb: {
        emoji: '🎁',
        title: t(ctx, 'admin_nowpayments_edit_cashback_button'),
        body: t(ctx, 'admin_nowpayments_cashback_prompt'),
      },
      exp: {
        emoji: '⏳',
        title: t(ctx, 'admin_nowpayments_edit_expiry_button'),
        body: t(ctx, 'admin_nowpayments_expiry_prompt'),
      },
    };
    const meta = promptKeyMap[field];
    await startAdminInput(ctx, {
      kind: 'pg_np_edit',
      payload: { field },
      returnRoute: 'adm:pg:np',
      promptText: buildAdminPromptScreen({
        emoji: meta.emoji,
        title: meta.title,
        body: meta.body,
      }),
      keyboard: adminInputCancelKeyboard(ctx),
    });
  });

  registerAdminRoute('adm:pg:np:test', async (ctx) => {
    const svc = ctx.services?.automatedPaymentService;
    if (!svc) return;
    const res = await svc.testNowPaymentsConnection();
    await renderNowPaymentsSettingsScreen(ctx, {
      tone: res.ok ? 'success' : 'warning',
      text: res.ok
        ? t(ctx, 'admin_nowpayments_test_ok', {
            rate: `${localizedNumber(res.rateToman, ctx)} ${t(ctx, 'currency_toman')}`,
          })
        : t(ctx, 'admin_nowpayments_test_failed', { reason: res.message }),
    });
  });

  // ── Non-Blocking Input Handlers ────────────────────────────────────────────

  registerAdminInputHandler('pg_fa_exp', async (ctx, rawText) => {
    const svc = ctx.services?.automatedPaymentService;
    if (!svc) return { status: 'done', redirectRoute: 'adm:pg:fa' };
    const minutes = parseBoundedInt(rawText, 5, 120);
    if (minutes === null) {
      return {
        status: 'retry',
        promptText: buildAdminPromptScreen({
          emoji: '⚠️',
          title: t(ctx, 'admin_forapp_edit_expiry_button'),
          body: t(ctx, 'admin_forapp_expiry_invalid'),
        }),
      };
    }
    await svc.updateForAppConfig({ orderExpiryMinutes: minutes });
    return {
      status: 'done',
      redirectRoute: 'adm:pg:fa',
      notice: { tone: 'success', text: t(ctx, 'admin_auto_pay_saved') },
    };
  });

  registerAdminInputHandler('pg_fad_match', async (ctx, rawText, state) => {
    const svc = ctx.services?.automatedPaymentService;
    const adminId = ctx.from?.id;
    const depositId = typeof state.payload?.depositId === 'string' ? state.payload.depositId : '';
    if (!svc || !adminId || !depositId) {
      return { status: 'done', redirectRoute: 'adm:pg:fad:1' };
    }

    const query = normalizeInputDigits(rawText).trim();
    const profile = await ctx.services?.userService?.findProfile?.(query);
    if (!profile) {
      return {
        status: 'retry',
        promptText: buildAdminPromptScreen({
          emoji: '⚠️',
          title: t(ctx, 'admin_forapp_deposit_match_button'),
          body: t(ctx, 'admin_user_not_found'),
        }),
      };
    }

    try {
      const matched = await svc.manualMatchForAppDeposit({
        depositId,
        targetTelegramId: profile.telegramId,
        adminId,
      });
      if (ctx.services?.botApi) {
        await sendAutomatedTopupSuccessNotification(ctx.services.botApi, ctx.services, {
          telegramId: matched.telegramId,
          amount: matched.creditedAmount,
          balanceAfter: matched.balanceAfter,
          provider: 'forapp_card',
          orderId: matched.deposit.id,
        });
      }
      return {
        status: 'done',
        redirectRoute: 'adm:pg:fad:1',
        notice: {
          tone: 'success',
          text: t(ctx, 'admin_forapp_deposit_matched_notice', {
            amount: localizedNumber(matched.creditedAmount, ctx),
            currency: t(ctx, 'currency_toman'),
            telegram_id: String(matched.telegramId),
          }),
        },
      };
    } catch (err) {
      const msg = err instanceof AutomatedPaymentError ? err.code : t(ctx, 'operation_failed');
      return {
        status: 'done',
        redirectRoute: 'adm:pg:fad:1',
        notice: { tone: 'warning', text: msg },
      };
    }
  });

  registerAdminInputHandler('pg_np_edit', async (ctx, rawText, state) => {
    const svc = ctx.services?.automatedPaymentService;
    const field = typeof state.payload?.field === 'string' ? state.payload.field : '';
    if (!svc || !field) return { status: 'done', redirectRoute: 'adm:pg:np' };

    try {
      if (field === 'key') {
        const trimmed = rawText.trim();
        await svc.updateNowPaymentsConfig({ apiKey: trimmed });
      } else if (field === 'ipn') {
        const trimmed = rawText.trim();
        await svc.updateNowPaymentsConfig({ ipnSecret: trimmed });
      } else if (field === 'rate') {
        const val = parseBoundedInt(rawText, 10_000, 5_000_000);
        if (val === null) throw new AutomatedPaymentError('INVALID_USD_RATE');
        await svc.updateNowPaymentsConfig({ manualUsdRateToman: val });
      } else if (field === 'min') {
        const val = parseBoundedInt(rawText, 10_000, Number.MAX_SAFE_INTEGER);
        if (val === null) throw new AutomatedPaymentError('INVALID_MIN_AMOUNT');
        await svc.updateNowPaymentsConfig({ minAmountToman: val });
      } else if (field === 'max') {
        const val = parseBoundedInt(rawText, 10_000, Number.MAX_SAFE_INTEGER);
        if (val === null) throw new AutomatedPaymentError('INVALID_MAX_AMOUNT');
        await svc.updateNowPaymentsConfig({ maxAmountToman: val });
      } else if (field === 'cb') {
        const val = parseBoundedInt(rawText, 0, 50);
        if (val === null) throw new AutomatedPaymentError('INVALID_CASHBACK_PERCENT');
        await svc.updateNowPaymentsConfig({ cashbackPercent: val });
      } else if (field === 'exp') {
        const val = parseBoundedInt(rawText, 10, 1440);
        if (val === null) throw new AutomatedPaymentError('INVALID_EXPIRY_MINUTES');
        await svc.updateNowPaymentsConfig({ orderExpiryMinutes: val });
      }

      return {
        status: 'done',
        redirectRoute: 'adm:pg:np',
        notice: { tone: 'success', text: t(ctx, 'admin_auto_pay_saved') },
      };
    } catch {
      return {
        status: 'retry',
        promptText: buildAdminPromptScreen({
          emoji: '⚠️',
          title: t(ctx, 'admin_nowpayments_title'),
          body: t(ctx, 'admin_auto_pay_invalid_value'),
        }),
      };
    }
  });
}
