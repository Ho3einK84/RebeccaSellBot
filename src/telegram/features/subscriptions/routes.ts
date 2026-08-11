import { InlineKeyboard, InputFile, type Bot } from 'grammy';
import QRCode from 'qrcode';
import type { MenuContext } from '../../types.js';
import { callbackData } from '../../callbackData.js';
import {
  formatSubscriptionLink,
  localizedDate,
  localizedNumber,
  localizedPackageName,
  resolveContextLocale,
  t,
  tm,
} from '../../locale.js';
import { backKeyboard, rememberArtifactMessage } from '../../ui.js';
import { trackFunnelEvent } from '../../../domain/services/FunnelTelemetry.js';
import { acquireUserActionCooldown } from '../../middleware/actionCooldown.js';
import { clearPendingPromo, getPendingPromoPricing } from '../../promoSelection.js';
import { purchaseFailureMessage } from '../../purchaseFeedback.js';
import type { ConfigService } from '../../../domain/services/ConfigService.js';
import { customVolumeEnabled } from '../../../domain/services/FeatureSettings.js';
import { RefundOutcomePendingError } from '../../../domain/services/RefundService.js';
import { PurchaseCheckoutUnavailableError } from '../../../domain/services/PurchaseCheckoutService.js';
import type { RebeccaUserDetail } from '../../../domain/services/RebeccaService.js';

const SUBSCRIPTION_PAGE_SIZE = 4;
const CONFIG_ID_CAPTURE = '([a-zA-Z0-9_]{3,40})';
type UserConfigRecord = NonNullable<Awaited<ReturnType<ConfigService['getConfigById']>>>;

export function buildRenewalSelectionKeyboard(
  ctx: MenuContext,
  configId: string,
  panelId?: string,
  serviceId?: number
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const packages = ctx.services!.pricingService.getPackages(panelId, serviceId);
  for (const [index, pkg] of packages.entries()) {
    keyboard
      .text(
        t(ctx, 'package_button', {
          name: localizedPackageName(ctx, pkg.id, pkg.name),
          price: localizedNumber(pkg.price, ctx),
        }),
        callbackData('renew', 'package', configId, index)
      )
      .row();
  }
  if (customVolumeEnabled(ctx.services!.translationService)) {
    const pricePerGb = ctx.services!.translationService.getSettingNum('price_per_gb', 5_000);
    keyboard
      .text(
        t(ctx, 'renew_custom_button', { price: localizedNumber(pricePerGb, ctx) }),
        callbackData('renew', 'custom', configId)
      )
      .row();
  }
  return keyboard.text(t(ctx, 'menu_cancel'), 'conversation:cancel');
}

export async function showUserSubscriptions(ctx: MenuContext, requestedPage = 1): Promise<void> {
  if (!ctx.services || !ctx.from?.id) return;
  const configs = await ctx.services.configService.listConfigsForOwner(ctx.from.id);
  if (configs.length === 0) {
    await ctx.reply(t(ctx, 'no_subscriptions'), { reply_markup: backKeyboard(ctx, 'main') });
    return;
  }
  const totalPages = Math.max(1, Math.ceil(configs.length / SUBSCRIPTION_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(requestedPage)), totalPages);
  const pageConfigs = configs.slice(
    (page - 1) * SUBSCRIPTION_PAGE_SIZE,
    page * SUBSCRIPTION_PAGE_SIZE
  );
  const cards = await Promise.all(
    pageConfigs.map((config) => buildSubscriptionCard(ctx, config, false))
  );
  for (const card of cards) {
    await ctx.reply(card.text, { parse_mode: 'Markdown', reply_markup: card.keyboard });
  }
  const navigation = new InlineKeyboard();
  if (totalPages > 1) {
    if (page > 1) navigation.text(t(ctx, 'pagination_previous'), `subs:page:${page - 1}`);
    navigation.text(
      `${localizedNumber(page, ctx)} / ${localizedNumber(totalPages, ctx)}`,
      `subs:page:${page}`
    );
    if (page < totalPages) navigation.text(t(ctx, 'pagination_next'), `subs:page:${page + 1}`);
    navigation.row();
  }
  navigation.text(t(ctx, 'menu_back'), 'nav:main');
  await ctx.reply(
    t(ctx, 'subscriptions_list_complete', {
      count: localizedNumber(pageConfigs.length, ctx),
    }),
    { reply_markup: navigation }
  );
}

export function registerSubscriptionRoutes(bot: Bot<MenuContext>): void {
  bot.callbackQuery(/^subs:page:(\d+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
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
    const keyboard = buildRenewalSelectionKeyboard(
      ctx,
      config.id,
      config.panelId,
      config.serviceId
    );
    await ctx.reply(t(ctx, 'renew_select_package', { username: config.configUsername }), {
      reply_markup: keyboard,
    });
  });

  bot.callbackQuery(new RegExp(`^renew:package:${CONFIG_ID_CAPTURE}:(\\d+)$`, 'u'), async (ctx) => {
    const config = await ownedConfig(ctx, ctx.match[1]!);
    if (!config) return;
    const packageIndex = Number(ctx.match[2]);
    const pkg = ctx.services!.pricingService.getPackages(config.panelId, config.serviceId)[
      packageIndex
    ];
    if (!pkg) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'renewal_package_missing'), show_alert: true });
      return;
    }
    const pendingPromo = await getPendingPromoPricing(ctx, ctx.from.id, pkg.price, pkg.gbAmount);
    if (pendingPromo.messageKey) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'promo_no_longer_usable'), show_alert: true });
      await ctx.reply(t(ctx, pendingPromo.messageKey), { reply_markup: backKeyboard(ctx) });
      return;
    }
    const price = pendingPromo.quote?.finalAmount ?? pkg.price;
    if ((await ctx.services!.walletService.getBalance(ctx.from.id)) < price) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'insufficient_balance'), show_alert: true });
      await ctx.reply(t(ctx, 'insufficient_balance'), { reply_markup: backKeyboard(ctx) });
      return;
    }
    await ctx.answerCallbackQuery();
    const params = {
      username: config.configUsername,
      gb: localizedNumber(pkg.gbAmount, ctx),
      days: localizedNumber(pkg.durationDays, ctx),
      amount: localizedNumber(price, ctx),
      price_per_gb: localizedNumber(Math.round(pkg.price / pkg.gbAmount), ctx),
      promo_code: pendingPromo.quote?.code ?? '',
    };
    const checkout = await ctx.services!.purchaseCheckoutService.create({
      telegramId: ctx.from.id,
      kind: 'renew_config',
      configId: config.id,
      pkg,
      panelId: config.panelId,
      serviceId: pkg.serviceId ?? config.serviceId,
      promoCode: pendingPromo.promoCode,
      quotedAmount: price,
    });
    await ctx.reply(
      tm(ctx, pendingPromo.quote ? 'renewal_quote_with_promo' : 'renewal_quote', params),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(t(ctx, 'renew_confirm_button'), callbackData('renew', 'confirm', checkout.id))
          .row()
          .text(t(ctx, 'menu_cancel'), 'conversation:cancel'),
      }
    );
  });

  bot.callbackQuery(/^renew:confirm:(co_[A-Za-z0-9_-]{8,32})$/u, async (ctx) => {
    if (!ctx.services) return;
    let checkout;
    try {
      checkout = await ctx.services.purchaseCheckoutService.claim(ctx.match[1]!, ctx.from.id);
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
      ? await ctx.services.configService.getOwnedConfigById(ctx.from.id, checkout.configId)
      : undefined;
    if (!config || config.panelId !== checkout.panelId) {
      await ctx.services.purchaseCheckoutService.fail(checkout.id);
      await ctx.answerCallbackQuery({ text: t(ctx, 'config_not_owned'), show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: t(ctx, 'renewing') });
    try {
      const result = await ctx.services!.walletService.executePurchaseSaga({
        telegramId: ctx.from.id,
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
      });
      await ctx.services.purchaseCheckoutService.complete(checkout.id);
      if (checkout.promoCode) clearPendingPromo(ctx);
      const sent = await ctx.reply(
        t(ctx, 'renewal_success', {
          username: result.configUsername,
          package_name: localizedPackageName(ctx, checkout.packageId, checkout.packageName),
        }),
        { reply_markup: backKeyboard(ctx, 'main') }
      );
      rememberArtifactMessage(ctx.session, sent.message_id);
    } catch (err) {
      await ctx.services.purchaseCheckoutService.fail(checkout.id);
      await ctx.reply(
        purchaseFailureMessage(ctx.services!.translationService, err, resolveContextLocale(ctx)),
        { reply_markup: backKeyboard(ctx, 'main') }
      );
    }
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
    const config = await ownedConfig(ctx, ctx.match[1]!);
    if (!config) return;
    trackFunnelEvent('service_first_view');
    await ctx.answerCallbackQuery();
    const card = await buildSubscriptionCard(ctx, config, true);
    await ctx.reply(card.text, { parse_mode: 'Markdown', reply_markup: card.keyboard });
  });

  bot.callbackQuery(new RegExp(`^config:refresh:${CONFIG_ID_CAPTURE}$`, 'u'), async (ctx) => {
    const config = await ownedConfig(ctx, ctx.match[1]!);
    if (!config) return;
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    const card = await buildSubscriptionCard(ctx, config, true);
    await ctx.editMessageText(card.text, { parse_mode: 'Markdown', reply_markup: card.keyboard });
  });

  bot.callbackQuery(new RegExp(`^autorenew:(on|off):${CONFIG_ID_CAPTURE}$`, 'u'), async (ctx) => {
    const enabled = ctx.match[1] === 'on';
    const config = await ownedConfig(ctx, ctx.match[2]!);
    if (!config) return;
    await ctx.answerCallbackQuery();

    if (!enabled) {
      delete ctx.session.pendingAutoRenew;
      await ctx.reply(t(ctx, 'auto_renew_disable_confirm', { username: config.configUsername }), {
        reply_markup: new InlineKeyboard()
          .text(t(ctx, 'admin_confirm_button'), callbackData('autorenew', 'off_confirm', config.id))
          .row()
          .text(t(ctx, 'menu_cancel'), callbackData('config', 'view', config.id)),
      });
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const [index, pkg] of ctx
      .services!.pricingService.getPackages(config.panelId, config.serviceId)
      .entries()) {
      keyboard
        .text(
          t(ctx, 'package_button', {
            name: localizedPackageName(ctx, pkg.id, pkg.name),
            price: localizedNumber(pkg.price, ctx),
          }),
          callbackData('autorenew', 'pkg', config.id, index)
        )
        .row();
    }
    if (customVolumeEnabled(ctx.services!.translationService)) {
      const pricePerGb = ctx.services!.translationService.getSettingNum('price_per_gb', 5_000);
      keyboard
        .text(
          t(ctx, 'renew_custom_button', { price: localizedNumber(pricePerGb, ctx) }),
          callbackData('autorenew', 'custom', config.id)
        )
        .row();
    }
    keyboard.text(t(ctx, 'admin_menu_back'), `config:view:${config.id}`).row();
    await ctx.reply(t(ctx, 'auto_renew_select_package'), { reply_markup: keyboard });
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

  bot.callbackQuery(new RegExp(`^autorenew:pkg:${CONFIG_ID_CAPTURE}:(\\d+)$`, 'u'), async (ctx) => {
    const config = await ownedConfig(ctx, ctx.match[1]!);
    if (!config) return;
    const packageIndex = Number(ctx.match[2]);
    const pkg = Number.isSafeInteger(packageIndex)
      ? ctx.services!.pricingService.getPackages(config.panelId, config.serviceId)[packageIndex]
      : undefined;
    if (!pkg) {
      await ctx.answerCallbackQuery({
        text: t(ctx, 'auto_renew_package_unavailable'),
        show_alert: true,
      });
      return;
    }
    ctx.session.pendingAutoRenew = { configId: config.id, packageId: pkg.id, price: pkg.price };
    await ctx.answerCallbackQuery();
    await ctx.reply(
      t(ctx, 'auto_renew_confirm', {
        username: config.configUsername,
        package: localizedPackageName(ctx, pkg.id, pkg.name),
        price: localizedNumber(pkg.price, ctx),
      }),
      {
        reply_markup: new InlineKeyboard()
          .text(t(ctx, 'admin_confirm_button'), callbackData('autorenew', 'confirm', config.id))
          .row()
          .text(t(ctx, 'menu_cancel'), callbackData('config', 'view', config.id)),
      }
    );
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
    const pkg = ctx
      .services!.pricingService.getPackages(config.panelId, config.serviceId)
      .find((item) => item.id === pending.packageId && item.price === pending.price);
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
    await ctx.services!.configService.setAutoRenew(ctx.from.id, config.id, true, pkg.id, pkg.price);
    const returnKeyboard = new InlineKeyboard().text(
      t(ctx, 'admin_menu_back'),
      callbackData('config', 'view', config.id)
    );
    await ctx.reply(t(ctx, 'auto_renew_enabled'), { reply_markup: returnKeyboard });
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
      await ctx.services!.configService.setAutoRenew(ctx.from.id, config.id, false);
      const returnKeyboard = new InlineKeyboard().text(
        t(ctx, 'admin_menu_back'),
        callbackData('config', 'view', config.id)
      );
      await ctx.reply(t(ctx, 'auto_renew_disabled'), { reply_markup: returnKeyboard });
    }
  );

  bot.callbackQuery(new RegExp(`^config:toggle:${CONFIG_ID_CAPTURE}$`, 'u'), async (ctx) => {
    const config = await ownedConfig(ctx, ctx.match[1]!);
    if (!config) return;
    await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
    try {
      const remote = await ctx
        .services!.panelRegistry.getService(config.panelId)
        .getUser(config.configUsername);
      if (remote.status === 'disabled') {
        await ctx.services!.configService.enableConfig(config.configUsername, config.panelId);
      } else {
        await ctx.services!.configService.disableConfig(config.configUsername, config.panelId);
      }
      await showUserSubscriptions(ctx);
    } catch {
      await ctx.reply(t(ctx, 'config_action_failed'), { reply_markup: backKeyboard(ctx) });
    }
  });

  bot.callbackQuery(new RegExp(`^config:revoke_prompt:${CONFIG_ID_CAPTURE}$`, 'u'), async (ctx) => {
    const config = await ownedConfig(ctx, ctx.match[1]!);
    if (!config) return;
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      t(ctx, 'subscription_revoke_confirm', { username: config.configUsername }),
      {
        reply_markup: new InlineKeyboard()
          .text(t(ctx, 'admin_confirm_button'), callbackData('config', 'revoke_confirm', config.id))
          .row()
          .text(t(ctx, 'menu_cancel'), callbackData('config', 'refresh', config.id)),
      }
    );
  });

  bot.callbackQuery(
    new RegExp(`^config:revoke_confirm:${CONFIG_ID_CAPTURE}$`, 'u'),
    async (ctx) => {
      const config = await ownedConfig(ctx, ctx.match[1]!);
      if (!config) return;
      await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
      try {
        const url = await ctx.services!.configService.revokeSubscription(
          config.configUsername,
          config.panelId
        );
        const sentMsg = await ctx.reply(
          tm(ctx, 'subscription_link_revoked', {
            sub_url: formatSubscriptionLink(url, t(ctx, 'subscription_link_unavailable')),
          }),
          { parse_mode: 'Markdown', reply_markup: backKeyboard(ctx) }
        );
        rememberArtifactMessage(ctx.session, sentMsg.message_id);
      } catch {
        await ctx.reply(t(ctx, 'config_action_failed'), { reply_markup: backKeyboard(ctx) });
      }
    }
  );

  bot.callbackQuery(new RegExp(`^config:delete_prompt:${CONFIG_ID_CAPTURE}$`, 'u'), async (ctx) => {
    const config = await ownedConfig(ctx, ctx.match[1]!);
    if (!config) return;
    await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
    const quote = await ctx.services!.refundService.quote(ctx.from.id, config.id);
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
      .text(t(ctx, 'menu_cancel'), callbackData('config', 'refresh', config.id));

    await ctx.editMessageText(
      quote.eligible
        ? tm(ctx, 'config_delete_refund_warning', {
            username: config.configUsername,
            gross_amount: localizedNumber(quote.grossAmount, ctx),
            cashback_withheld: localizedNumber(quote.cashbackWithheld, ctx),
            refund_amount: localizedNumber(quote.refundAmount, ctx),
          })
        : tm(ctx, 'config_delete_no_refund_warning', {
            username: config.configUsername,
            reason: t(ctx, `refund_reason_${quote.reason}`),
          }),
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
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
          ctx.from.id,
          config.id
        );
        if (!result.eligible) {
          await ctx.reply(
            t(ctx, 'config_refund_not_eligible', {
              reason: t(ctx, `refund_reason_${result.reason}`),
            }),
            { reply_markup: backKeyboard(ctx, 'main') }
          );
          return;
        }
        await ctx.reply(
          tm(ctx, 'config_refunded_deleted', {
            username: result.configUsername,
            amount: localizedNumber(result.refundAmount, ctx),
          }),
          { parse_mode: 'Markdown', reply_markup: backKeyboard(ctx, 'main') }
        );
      } catch (err) {
        await ctx.reply(
          t(
            ctx,
            err instanceof RefundOutcomePendingError
              ? 'config_refund_pending'
              : 'config_refund_failed'
          ),
          { reply_markup: backKeyboard(ctx, 'main') }
        );
      }
    }
  );

  bot.callbackQuery(
    new RegExp(`^config:delete_confirm:${CONFIG_ID_CAPTURE}$`, 'u'),
    async (ctx) => {
      const config = await ownedConfig(ctx, ctx.match[1]!);
      if (!config) return;
      await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
      const deleted = await ctx.services!.configService.deleteConfigCompletely(
        config.configUsername,
        config.panelId
      );
      await ctx.reply(
        tm(ctx, deleted ? 'config_deleted' : 'config_delete_not_found', {
          username: config.configUsername,
        }),
        { parse_mode: 'Markdown', reply_markup: backKeyboard(ctx) }
      );
    }
  );

  bot.callbackQuery(new RegExp(`^config:transfer:${CONFIG_ID_CAPTURE}$`, 'u'), async (ctx) => {
    const config = await ownedConfig(ctx, ctx.match[1]!);
    if (!config) return;
    ctx.session.transferConfigId = config.id;
    ctx.session.transferConfigOwnerTelegramId = ctx.from.id;
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('transferConfigConversation');
  });

  bot.callbackQuery(new RegExp(`^config:qr:${CONFIG_ID_CAPTURE}$`, 'u'), async (ctx) => {
    const config = await ownedConfig(ctx, ctx.match[1]!);
    if (!config) return;
    await ctx.answerCallbackQuery({ text: t(ctx, 'subscription_qr_generating') });
    try {
      const remote = await ctx
        .services!.panelRegistry.getService(config.panelId)
        .getUser(config.configUsername);
      const url = remote.subscription_url || config.subUrl;
      if (!url) throw new Error('SUBSCRIPTION_URL_UNAVAILABLE');
      const image = await QRCode.toBuffer(url, {
        width: 720,
        margin: 2,
        errorCorrectionLevel: 'M',
      });
      const photo = await ctx.replyWithPhoto(new InputFile(image, `${config.configUsername}.png`), {
        caption: t(ctx, 'subscription_qr_caption', { username: config.configUsername }),
        reply_markup: backKeyboard(ctx, 'main'),
      });
      rememberArtifactMessage(ctx.session, photo.message_id);
    } catch {
      await ctx.reply(t(ctx, 'subscription_qr_failed'), { reply_markup: backKeyboard(ctx) });
    }
  });
}

async function ownedConfig(ctx: MenuContext, configId: string) {
  if (!ctx.services || !ctx.from) return undefined;
  const config = await ctx.services.configService.getOwnedConfigById(ctx.from.id, configId);
  if (!config) {
    await ctx.answerCallbackQuery({ text: t(ctx, 'config_not_owned'), show_alert: true });
  }
  return config;
}

async function buildSubscriptionCard(
  ctx: MenuContext,
  config: UserConfigRecord,
  isDetailView = false
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  let remote: RebeccaUserDetail | undefined;
  try {
    remote = await ctx
      .services!.panelRegistry.getService(config.panelId)
      .getUser(config.configUsername);
  } catch {
    remote = undefined;
  }

  const dataLimit = remote?.data_limit ?? config.panelDataLimit;
  const usedTraffic = remote?.used_traffic ?? 0;
  const remainingBytes = dataLimit == null ? undefined : Math.max(0, dataLimit - usedTraffic);
  const expire = remote?.expire ?? config.panelExpire;
  const status = effectiveStatus(
    remote?.status ?? config.panelStatus ?? 'unknown',
    remainingBytes,
    expire
  );
  const remaining =
    remainingBytes === undefined
      ? t(ctx, 'unlimited')
      : `${localizedNumber(Number((remainingBytes / 1024 ** 3).toFixed(2)), ctx)} ${t(ctx, 'traffic_unit_gb')}`;
  const expiryInfo = formatExpiry(ctx, expire);
  const onlineInfo = formatOnline(ctx, remote?.online_at ?? undefined);
  const subUrl = remote?.subscription_url || config.subUrl;
  const pkgOption = config.autoRenewPackageId
    ? ctx.services?.pricingService.getPackageById(config.autoRenewPackageId)
    : undefined;
  const packageName = pkgOption
    ? localizedPackageName(ctx, pkgOption.id, pkgOption.name)
    : undefined;
  const autoRenewState = config.autoRenewEnabled
    ? t(ctx, 'auto_renew_state_enabled', {
        package: packageName ?? t(ctx, 'auto_renew_package_unavailable'),
      })
    : t(ctx, 'auto_renew_state_disabled');

  let text: string;
  if (!isDetailView) {
    text = `📱 *${config.configUsername}* | ${localizedSubscriptionStatus(ctx, status)}\n📊 *${t(ctx, 'remaining') || 'حجم باقیمانده'}:* ${remaining}\n⏳ *${t(ctx, 'expiry') || 'اعتبار'}:* ${expiryInfo}`;
  } else {
    text = `${tm(ctx, remote ? 'subscription_status' : 'subscription_status_cached', {
      username: config.configUsername,
      status: localizedSubscriptionStatus(ctx, status),
      remaining,
      expiry_info: expiryInfo,
      online_info: onlineInfo,
      created_info: localizedDate(new Date(remote?.created_at || config.createdAt), ctx),
      sub_url: formatSubscriptionLink(subUrl ?? undefined, t(ctx, 'subscription_link_unavailable')),
    })}\n\n${autoRenewState}`;
  }

  const keyboard = buildSubscriptionActionKeyboard(
    ctx,
    config.id,
    status,
    config.autoRenewEnabled,
    isDetailView
  );
  return { text, keyboard };
}

/** Action-only keyboard; navigation is emitted once after the page of cards. */
export function buildSubscriptionActionKeyboard(
  ctx: MenuContext,
  configId: string,
  status: string,
  autoRenewEnabled = false,
  isDetailView = false
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  if (!isDetailView) {
    return keyboard
      .text(
        t(ctx, 'subscription_view_detail', undefined) || '👁 مشاهده سرویس',
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

  // Advanced Actions Section
  keyboard
    .text(
      status === 'disabled'
        ? t(ctx, 'subscription_enable_button')
        : t(ctx, 'subscription_disable_button'),
      callbackData('config', 'toggle', configId)
    )
    .text(t(ctx, 'subscription_revoke_button'), callbackData('config', 'revoke_prompt', configId))
    .row()
    .text(t(ctx, 'subscription_transfer_button'), callbackData('config', 'transfer', configId))
    .row();

  // Danger Zone Actions
  keyboard
    .text(t(ctx, 'config_delete_button'), callbackData('config', 'delete_prompt', configId))
    .row()
    .text(t(ctx, 'menu_back'), 'subs:page:1');

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

function localizedSubscriptionStatus(ctx: MenuContext, status: string): string {
  const key = `subscription_status_${status}`;
  const translated = t(ctx, key);
  return translated === key ? t(ctx, 'subscription_status_unknown', { status }) : translated;
}
