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
import {
  backKeyboard,
  buildEmptyState,
  buildScreen,
  buildStatusBadge,
  dismissKeyboard,
  rememberArtifactMessage,
  renderUiScreen,
  type StatusType,
} from '../../ui.js';
import { trackFunnelEvent } from '../../../domain/services/FunnelTelemetry.js';
import { acquireUserActionCooldown } from '../../middleware/actionCooldown.js';
import { clearPendingPromo, getPendingPromoPricing } from '../../promoSelection.js';
import { purchaseFailureMessage } from '../../purchaseFeedback.js';
import type { ConfigService } from '../../../domain/services/ConfigService.js';
import { customVolumeEnabled } from '../../../domain/services/FeatureSettings.js';
import { calculateTraffic } from '../../../domain/services/ConfigLifecycle.js';
import { RefundOutcomePendingError } from '../../../domain/services/RefundService.js';
import { PurchaseCheckoutUnavailableError } from '../../../domain/services/PurchaseCheckoutService.js';
import type { RebeccaUserDetail } from '../../../domain/services/RebeccaService.js';
import { escapeTelegramMarkdown, sanitizeTelegramInlineCode } from '../../rendering.js';
import { packageCatalogToken } from '../../packageCatalog.js';
import { recordCheckoutCompleted, recordCheckoutFailed } from '../../checkoutLifecycle.js';

const SUBSCRIPTION_PAGE_SIZE = 4;
const CONFIG_ID_CAPTURE = '([a-zA-Z0-9_]{3,40})';
type UserConfigRecord = NonNullable<Awaited<ReturnType<ConfigService['getConfigById']>>>;
type SubscriptionSnapshot = {
  remote?: RebeccaUserDetail;
  status: string;
  statusLabel: string;
  remaining: string;
  expiryInfo: string;
  onlineInfo: string;
  createdInfo: string;
  subUrl?: string;
  autoRenewPackageName?: string;
};
type DeleteQuote =
  | {
      eligible: true;
      grossAmount: number;
      cashbackWithheld: number;
      refundAmount: number;
    }
  | { eligible: false; reason: string };

export function buildRenewalSelectionKeyboard(
  ctx: MenuContext,
  configId: string,
  panelId?: string,
  serviceId?: number
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const packages = ctx.services!.pricingService.getPackages(panelId, serviceId);
  const catalogToken = packageCatalogToken(packages);
  for (const [index, pkg] of packages.entries()) {
    keyboard
      .text(
        t(ctx, 'package_button', {
          name: localizedPackageName(ctx, pkg.id, pkg.name),
          price: localizedNumber(pkg.price, ctx),
        }),
        callbackData('r', 'p', configId, index, catalogToken)
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
  return keyboard.text(t(ctx, 'menu_back'), callbackData('config', 'view', configId));
}

export async function showUserSubscriptions(
  ctx: MenuContext,
  requestedPage?: number
): Promise<void> {
  if (!ctx.services || !ctx.from?.id) return;
  const targetPage = requestedPage ?? ctx.session?.subscriptionListPage ?? 1;
  const configs = await ctx.services.configService.listConfigsForOwner(ctx.from.id);
  if (configs.length === 0) {
    await renderSubscriptionScreen(
      ctx,
      buildEmptyState(
        '📭',
        t(ctx, 'subscription_list_empty_title'),
        t(ctx, 'subscription_list_empty_body'),
        `🛍️ ${t(ctx, 'subscription_list_empty_action')}`
      ),
      new InlineKeyboard()
        .text(t(ctx, 'menu_buy_subscription'), 'nav:shop')
        .row()
        .text(t(ctx, 'menu_back'), 'nav:main')
    );
    return;
  }
  const totalPages = Math.max(1, Math.ceil(configs.length / SUBSCRIPTION_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(targetPage)), totalPages);
  if (ctx.session) {
    ctx.session.subscriptionListPage = page;
  }
  const pageConfigs = configs.slice(
    (page - 1) * SUBSCRIPTION_PAGE_SIZE,
    page * SUBSCRIPTION_PAGE_SIZE
  );
  const cards = await Promise.all(
    pageConfigs.map((config) => buildSubscriptionSnapshot(ctx, config))
  );
  const navigation = new InlineKeyboard();
  for (const [index, config] of pageConfigs.entries()) {
    const card = cards[index]!;
    navigation
      .text(
        `${statusEmoji(card.status)} ${config.configUsername}`,
        callbackData('config', 'view', config.id)
      )
      .row();
  }
  if (totalPages > 1) {
    if (page > 1) navigation.text(t(ctx, 'pagination_previous'), `subs:page:${page - 1}`);
    navigation.text(
      `${localizedNumber(page, ctx)} / ${localizedNumber(totalPages, ctx)}`,
      'ui:noop'
    );
    if (page < totalPages) navigation.text(t(ctx, 'pagination_next'), `subs:page:${page + 1}`);
    navigation.row();
  }
  navigation.text(t(ctx, 'menu_back'), 'nav:main');
  await renderSubscriptionScreen(
    ctx,
    buildScreen({
      emoji: '📱',
      title: t(ctx, 'subscription_list_title'),
      subtitle: t(ctx, 'subscription_list_subtitle'),
      primary: {
        emoji: '📦',
        label: t(ctx, 'subscription_list_total_label'),
        value: localizedNumber(configs.length, ctx),
      },
      sections: pageConfigs.map((config, index) => {
        const card = cards[index]!;
        return {
          emoji: statusEmoji(card.status),
          title: `\`${sanitizeTelegramInlineCode(config.configUsername)}\``,
          fields: [
            {
              emoji: '⚡',
              label: t(ctx, 'subscription_status_label'),
              value: buildStatusBadge(ctx, statusBadgeType(card.status), card.statusLabel),
            },
            { emoji: '📊', label: t(ctx, 'remaining'), value: card.remaining },
            { emoji: '⏳', label: t(ctx, 'expiry'), value: card.expiryInfo },
          ],
        };
      }),
      footer: t(ctx, 'subscription_list_page', {
        page: localizedNumber(page, ctx),
        total_pages: localizedNumber(totalPages, ctx),
      }),
    }),
    navigation
  );
}

/** Render the current owned detail card; useful for refreshing legacy callbacks safely. */
export async function showSubscriptionDetail(
  ctx: MenuContext,
  configId: string,
  answerIfMissing = true
): Promise<boolean> {
  const config = await ownedConfig(ctx, configId, answerIfMissing);
  if (!config) return false;
  const card = await buildSubscriptionCard(ctx, config, true);
  await renderSubscriptionScreen(ctx, card.text, card.keyboard);
  return true;
}

async function renderRenewalSelection(ctx: MenuContext, config: UserConfigRecord): Promise<void> {
  const keyboard = buildRenewalSelectionKeyboard(ctx, config.id, config.panelId, config.serviceId);
  await renderSubscriptionScreen(
    ctx,
    buildScreen({
      emoji: '🔄',
      title: t(ctx, 'renewal_selection_title'),
      subtitle: t(ctx, 'renewal_selection_subtitle'),
      primary: {
        emoji: '📱',
        label: t(ctx, 'renewal_selection_service_label'),
        value: `\`${sanitizeTelegramInlineCode(config.configUsername)}\``,
      },
      footer: `ℹ️ ${t(ctx, 'renewal_selection_hint')}`,
    }),
    keyboard
  );
}

async function renderAutoRenewSelection(ctx: MenuContext, config: UserConfigRecord): Promise<void> {
  if (!ctx.services) return;
  const packages = ctx.services.pricingService.getPackages(config.panelId, config.serviceId);
  const catalogToken = packageCatalogToken(packages);
  const keyboard = new InlineKeyboard();
  for (const [index, pkg] of packages.entries()) {
    keyboard
      .text(
        t(ctx, 'package_button', {
          name: localizedPackageName(ctx, pkg.id, pkg.name),
          price: localizedNumber(pkg.price, ctx),
        }),
        callbackData('ar', 'p', config.id, index, catalogToken)
      )
      .row();
  }
  if (customVolumeEnabled(ctx.services.translationService)) {
    const pricePerGb = ctx.services.translationService.getSettingNum('price_per_gb', 5_000);
    keyboard
      .text(
        t(ctx, 'renew_custom_button', { price: localizedNumber(pricePerGb, ctx) }),
        callbackData('autorenew', 'custom', config.id)
      )
      .row();
  }
  keyboard.text(t(ctx, 'menu_back'), callbackData('config', 'view', config.id));
  await renderSubscriptionScreen(
    ctx,
    buildScreen({
      emoji: '♻️',
      title: t(ctx, 'auto_renew_selection_title'),
      subtitle: t(ctx, 'auto_renew_selection_subtitle'),
      primary: {
        emoji: '📱',
        label: t(ctx, 'renewal_selection_service_label'),
        value: `\`${sanitizeTelegramInlineCode(config.configUsername)}\``,
      },
      footer: `ℹ️ ${t(ctx, 'auto_renew_selection_hint')}`,
    }),
    keyboard
  );
}

export function registerSubscriptionRoutes(bot: Bot<MenuContext>): void {
  bot.callbackQuery(/^subs:page:(\d+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery({ text: t(ctx, 'subscriptions_loading') });
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
    await renderRenewalSelection(ctx, config);
  });

  bot.callbackQuery(
    new RegExp(`^r:p:${CONFIG_ID_CAPTURE}:(\\d+):([0-9a-f]{10})$`, 'u'),
    async (ctx) => {
      const config = await ownedConfig(ctx, ctx.match[1]!);
      if (!config) return;
      const packageIndex = Number(ctx.match[2]);
      const packages = ctx.services!.pricingService.getPackages(config.panelId, config.serviceId);
      const pkg =
        ctx.match[3] === packageCatalogToken(packages) && Number.isSafeInteger(packageIndex)
          ? packages[packageIndex]
          : undefined;
      if (!pkg) {
        await ctx.answerCallbackQuery({
          text: t(ctx, 'renewal_package_missing'),
          show_alert: true,
        });
        return;
      }
      const pendingPromo = await getPendingPromoPricing(ctx, ctx.from.id, pkg.price, pkg.gbAmount);
      if (pendingPromo.messageKey) {
        await ctx.answerCallbackQuery({ text: t(ctx, 'promo_no_longer_usable'), show_alert: true });
        await renderSubscriptionScreen(
          ctx,
          buildEmptyState('⚠️', t(ctx, 'renewal_selection_title'), t(ctx, pendingPromo.messageKey)),
          backKeyboard(ctx)
        );
        return;
      }
      const price = pendingPromo.quote?.finalAmount ?? pkg.price;
      if ((await ctx.services!.walletService.getBalance(ctx.from.id)) < price) {
        await ctx.answerCallbackQuery({ text: t(ctx, 'insufficient_balance'), show_alert: true });
        await renderSubscriptionScreen(
          ctx,
          buildEmptyState(
            '💳',
            t(ctx, 'insufficient_balance_title'),
            t(ctx, 'insufficient_balance'),
            t(ctx, 'insufficient_balance_hint')
          ),
          new InlineKeyboard()
            .text(t(ctx, 'topup_title'), 'topup:direct')
            .row()
            .text(t(ctx, 'menu_back'), callbackData('renew', 'open', config.id))
        );
        return;
      }
      await ctx.answerCallbackQuery();
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
      await renderSubscriptionScreen(
        ctx,
        buildRenewalCheckoutScreen(ctx, {
          username: config.configUsername,
          gbAmount: pkg.gbAmount,
          durationDays: pkg.durationDays,
          amount: price,
          pricePerGb: Math.round(price / pkg.gbAmount),
          promoCode: pendingPromo.quote?.code,
        }),
        new InlineKeyboard()
          .text(t(ctx, 'renew_confirm_button'), callbackData('renew', 'confirm', checkout.id))
          .row()
          .text(t(ctx, 'menu_back'), callbackData('config', 'view', config.id))
      );
    }
  );

  // Package-index callbacks from old screens cannot prove which catalog the
  // user reviewed. Refresh the current list instead of creating a checkout.
  bot.callbackQuery(new RegExp(`^renew:package:${CONFIG_ID_CAPTURE}:(\\d+)$`, 'u'), async (ctx) => {
    const config = await ownedConfig(ctx, ctx.match[1]!);
    if (!config) return;
    await ctx.answerCallbackQuery({
      text: t(ctx, 'purchase_confirmation_expired'),
      show_alert: true,
    });
    await renderRenewalSelection(ctx, config);
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
      await recordCheckoutFailed(ctx.services.purchaseCheckoutService, checkout.id);
      await ctx.answerCallbackQuery({ text: t(ctx, 'config_not_owned'), show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: t(ctx, 'renewing') });
    let result: { configUsername: string; subUrl?: string };
    try {
      result = await ctx.services!.walletService.executePurchaseSaga({
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
    } catch (err) {
      await recordCheckoutFailed(ctx.services.purchaseCheckoutService, checkout.id);
      await ctx.reply(
        purchaseFailureMessage(ctx.services!.translationService, err, resolveContextLocale(ctx)),
        { reply_markup: backKeyboard(ctx, 'main') }
      );
      return;
    }

    await recordCheckoutCompleted(ctx.services.purchaseCheckoutService, checkout.id);
    if (checkout.promoCode) clearPendingPromo(ctx);
    await renderSubscriptionScreen(
      ctx,
      buildScreen({
        emoji: '✅',
        title: t(ctx, 'renewal_success_title'),
        subtitle: t(ctx, 'renewal_success_subtitle'),
        primary: {
          emoji: '📱',
          label: t(ctx, 'renewal_success_service_label'),
          value: `\`${sanitizeTelegramInlineCode(result.configUsername)}\``,
        },
        sections: [
          {
            emoji: '📦',
            title: t(ctx, 'checkout_package_section'),
            fields: [
              {
                emoji: '✅',
                label: t(ctx, 'renewal_success_package_label'),
                value: escapeTelegramMarkdown(
                  localizedPackageName(ctx, checkout.packageId, checkout.packageName)
                ),
              },
            ],
          },
        ],
      }),
      backKeyboard(ctx, 'main')
    );
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
    await ctx.answerCallbackQuery({ text: t(ctx, 'subscriptions_loading') });
    trackFunnelEvent('service_first_view');
    await showSubscriptionDetail(ctx, ctx.match[1]!, false);
  });

  bot.callbackQuery(new RegExp(`^config:refresh:${CONFIG_ID_CAPTURE}$`, 'u'), async (ctx) => {
    const config = await ownedConfig(ctx, ctx.match[1]!);
    if (!config) return;
    await ctx.answerCallbackQuery({ text: t(ctx, 'subscription_refreshing') });
    const card = await buildSubscriptionCard(ctx, config, true);
    await renderSubscriptionScreen(ctx, card.text, card.keyboard);
  });

  bot.callbackQuery(new RegExp(`^autorenew:(on|off):${CONFIG_ID_CAPTURE}$`, 'u'), async (ctx) => {
    const enabled = ctx.match[1] === 'on';
    const config = await ownedConfig(ctx, ctx.match[2]!);
    if (!config) return;
    await ctx.answerCallbackQuery();

    if (!enabled) {
      delete ctx.session.pendingAutoRenew;
      await renderSubscriptionScreen(
        ctx,
        buildScreen({
          emoji: '♻️',
          title: t(ctx, 'auto_renew_disable_title'),
          subtitle: t(ctx, 'auto_renew_disable_subtitle'),
          primary: {
            emoji: '📱',
            label: t(ctx, 'renewal_selection_service_label'),
            value: `\`${sanitizeTelegramInlineCode(config.configUsername)}\``,
          },
          footer: `⚠️ ${t(ctx, 'auto_renew_disable_consequence')}`,
        }),
        new InlineKeyboard()
          .text(t(ctx, 'admin_confirm_button'), callbackData('autorenew', 'off_confirm', config.id))
          .row()
          .text(t(ctx, 'menu_back'), callbackData('config', 'view', config.id))
      );
      return;
    }

    await renderAutoRenewSelection(ctx, config);
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

  bot.callbackQuery(
    new RegExp(`^ar:p:${CONFIG_ID_CAPTURE}:(\\d+):([0-9a-f]{10})$`, 'u'),
    async (ctx) => {
      const config = await ownedConfig(ctx, ctx.match[1]!);
      if (!config) return;
      const packageIndex = Number(ctx.match[2]);
      const packages = ctx.services!.pricingService.getPackages(config.panelId, config.serviceId);
      const pkg =
        ctx.match[3] === packageCatalogToken(packages) && Number.isSafeInteger(packageIndex)
          ? packages[packageIndex]
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
      await renderSubscriptionScreen(
        ctx,
        buildScreen({
          emoji: '♻️',
          title: t(ctx, 'auto_renew_review_title'),
          subtitle: t(ctx, 'auto_renew_review_subtitle'),
          primary: {
            emoji: '💰',
            label: t(ctx, 'auto_renew_charge_label'),
            value: `${localizedNumber(pkg.price, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          sections: [
            {
              emoji: '📱',
              title: t(ctx, 'renewal_selection_service_label'),
              fields: [
                {
                  emoji: '🆔',
                  label: t(ctx, 'checkout_service_label'),
                  value: `\`${sanitizeTelegramInlineCode(config.configUsername)}\``,
                },
              ],
            },
            {
              emoji: '📦',
              title: t(ctx, 'checkout_package_section'),
              fields: [
                {
                  emoji: '📦',
                  label: t(ctx, 'renewal_success_package_label'),
                  value: escapeTelegramMarkdown(localizedPackageName(ctx, pkg.id, pkg.name)),
                },
              ],
            },
          ],
          footer: `ℹ️ ${t(ctx, 'auto_renew_review_hint')}`,
        }),
        new InlineKeyboard()
          .text(t(ctx, 'admin_confirm_button'), callbackData('autorenew', 'confirm', config.id))
          .row()
          .text(t(ctx, 'menu_back'), callbackData('config', 'view', config.id))
      );
    }
  );

  bot.callbackQuery(new RegExp(`^autorenew:pkg:${CONFIG_ID_CAPTURE}:(\\d+)$`, 'u'), async (ctx) => {
    const config = await ownedConfig(ctx, ctx.match[1]!);
    if (!config) return;
    await ctx.answerCallbackQuery({
      text: t(ctx, 'purchase_confirmation_expired'),
      show_alert: true,
    });
    await renderAutoRenewSelection(ctx, config);
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
    await renderSubscriptionScreen(
      ctx,
      buildScreen({
        emoji: '✅',
        title: t(ctx, 'auto_renew_enabled_title'),
        subtitle: t(ctx, 'auto_renew_enabled_subtitle'),
        primary: {
          emoji: '📱',
          label: t(ctx, 'renewal_selection_service_label'),
          value: `\`${sanitizeTelegramInlineCode(config.configUsername)}\``,
        },
      }),
      new InlineKeyboard().text(t(ctx, 'menu_back'), callbackData('config', 'view', config.id))
    );
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
      await renderSubscriptionScreen(
        ctx,
        buildScreen({
          emoji: '✅',
          title: t(ctx, 'auto_renew_disabled_title'),
          subtitle: t(ctx, 'auto_renew_disabled_subtitle'),
          primary: {
            emoji: '📱',
            label: t(ctx, 'renewal_selection_service_label'),
            value: `\`${sanitizeTelegramInlineCode(config.configUsername)}\``,
          },
        }),
        new InlineKeyboard().text(t(ctx, 'menu_back'), callbackData('config', 'view', config.id))
      );
    }
  );

  bot.callbackQuery(new RegExp(`^config:set:(on|off):${CONFIG_ID_CAPTURE}$`, 'u'), async (ctx) => {
    const enabled = ctx.match[1] === 'on';
    const config = await ownedConfig(ctx, ctx.match[2]!);
    if (!config) return;
    if (!acquireUserActionCooldown(ctx.from.id, `config-status:${config.id}`, 3_000)) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress'), show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
    try {
      if (enabled) {
        await ctx.services!.configService.enableConfig(config.configUsername, config.panelId);
      } else {
        await ctx.services!.configService.disableConfig(config.configUsername, config.panelId);
      }
      const card = await buildSubscriptionCard(ctx, config, true);
      await renderSubscriptionScreen(ctx, card.text, card.keyboard);
    } catch {
      await renderSubscriptionScreen(
        ctx,
        buildEmptyState('⚠️', t(ctx, 'subscription_status_label'), t(ctx, 'config_action_failed')),
        backKeyboard(ctx)
      );
    }
  });

  // Old toggle callbacks did not encode intent. A stale click could therefore
  // undo a newer state, so refresh the current detail card without mutating it.
  bot.callbackQuery(new RegExp(`^config:toggle:${CONFIG_ID_CAPTURE}$`, 'u'), async (ctx) => {
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await showSubscriptionDetail(ctx, ctx.match[1]!, false);
  });

  bot.callbackQuery(new RegExp(`^config:revoke_prompt:${CONFIG_ID_CAPTURE}$`, 'u'), async (ctx) => {
    const config = await ownedConfig(ctx, ctx.match[1]!);
    if (!config) return;
    await ctx.answerCallbackQuery();
    await renderSubscriptionScreen(
      ctx,
      buildScreen({
        emoji: '🔐',
        title: t(ctx, 'subscription_revoke_title'),
        subtitle: t(ctx, 'subscription_revoke_subtitle'),
        primary: {
          emoji: '📱',
          label: t(ctx, 'renewal_selection_service_label'),
          value: `\`${sanitizeTelegramInlineCode(config.configUsername)}\``,
        },
        footer: `⚠️ ${t(ctx, 'subscription_revoke_consequence')}`,
      }),
      new InlineKeyboard()
        .text(t(ctx, 'admin_confirm_button'), callbackData('config', 'revoke_confirm', config.id))
        .row()
        .text(t(ctx, 'menu_back'), callbackData('config', 'refresh', config.id))
    );
  });

  bot.callbackQuery(
    new RegExp(`^config:revoke_confirm:${CONFIG_ID_CAPTURE}$`, 'u'),
    async (ctx) => {
      const config = await ownedConfig(ctx, ctx.match[1]!);
      if (!config) return;
      if (!acquireUserActionCooldown(ctx.from.id, `revoke:${config.id}`, 5_000)) {
        await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress'), show_alert: true });
        return;
      }
      await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
      try {
        const url = await ctx.services!.configService.revokeSubscription(
          config.configUsername,
          config.panelId
        );
        await renderSubscriptionScreen(
          ctx,
          buildScreen({
            emoji: '✅',
            title: t(ctx, 'subscription_revoke_success_title'),
            subtitle: t(ctx, 'subscription_revoke_success_subtitle'),
            primary: {
              emoji: '🔗',
              label: t(ctx, 'subscription_link_label'),
              value: formatSubscriptionLink(url, t(ctx, 'subscription_link_unavailable')),
            },
            sections: [
              {
                emoji: '📱',
                title: t(ctx, 'renewal_selection_service_label'),
                fields: [
                  {
                    emoji: '🆔',
                    label: t(ctx, 'checkout_service_label'),
                    value: `\`${sanitizeTelegramInlineCode(config.configUsername)}\``,
                  },
                ],
              },
            ],
          }),
          new InlineKeyboard()
        );
        if (ctx.callbackQuery?.message) {
          rememberArtifactMessage(ctx.session, ctx.callbackQuery.message.message_id);
        }
        await ctx.reply(t(ctx, 'navigation_continue_hint'), {
          reply_markup: new InlineKeyboard()
            .text(t(ctx, 'menu_my_configs'), `subs:page:${ctx.session.subscriptionListPage ?? 1}`)
            .row()
            .text(t(ctx, 'menu_back'), 'nav:main'),
        });
      } catch {
        await renderSubscriptionScreen(
          ctx,
          buildEmptyState(
            '⚠️',
            t(ctx, 'subscription_revoke_title'),
            t(ctx, 'config_action_failed')
          ),
          backKeyboard(ctx)
        );
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
      .text(t(ctx, 'menu_back'), callbackData('config', 'refresh', config.id));

    await renderSubscriptionScreen(ctx, buildDeleteReviewScreen(ctx, config, quote), keyboard);
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
          await renderSubscriptionScreen(
            ctx,
            buildScreen({
              emoji: '⚠️',
              title: t(ctx, 'config_delete_review_title'),
              subtitle: t(ctx, 'config_delete_no_refund_subtitle'),
              primary: {
                emoji: '⚠️',
                label: t(ctx, 'config_delete_eligibility_label'),
                value: t(ctx, `refund_reason_${result.reason}`),
              },
            }),
            backKeyboard(ctx, 'main')
          );
          return;
        }
        await renderSubscriptionScreen(
          ctx,
          buildDeleteResultScreen(ctx, result.configUsername, result.refundAmount, true),
          backKeyboard(ctx, 'main')
        );
      } catch (err) {
        await renderSubscriptionScreen(
          ctx,
          buildEmptyState(
            err instanceof RefundOutcomePendingError ? '⏳' : '⚠️',
            t(ctx, 'config_delete_review_title'),
            t(
              ctx,
              err instanceof RefundOutcomePendingError
                ? 'config_refund_pending'
                : 'config_refund_failed'
            )
          ),
          backKeyboard(ctx, 'main')
        );
      }
    }
  );

  bot.callbackQuery(
    new RegExp(`^config:delete_confirm:${CONFIG_ID_CAPTURE}$`, 'u'),
    async (ctx) => {
      const config = await ownedConfig(ctx, ctx.match[1]!);
      if (!config) return;
      if (!acquireUserActionCooldown(ctx.from.id, `config-delete:${config.id}`, 3_000)) {
        await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
        return;
      }
      await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });
      try {
        const deleted = await ctx.services!.configService.deleteConfigCompletely(
          config.configUsername,
          config.panelId
        );
        await renderSubscriptionScreen(
          ctx,
          deleted
            ? buildDeleteResultScreen(ctx, config.configUsername, undefined, false)
            : buildEmptyState(
                '⚠️',
                t(ctx, 'config_delete_review_title'),
                tm(ctx, 'config_delete_not_found', { username: config.configUsername })
              ),
          backKeyboard(ctx, 'main')
        );
      } catch {
        await renderSubscriptionScreen(
          ctx,
          buildEmptyState(
            '⚠️',
            t(ctx, 'config_delete_review_title'),
            t(ctx, 'config_action_failed')
          ),
          backKeyboard(ctx, 'main')
        );
      }
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
      const remote = await ctx.services!.configService.getRemoteConfigDetail(config);
      const url = remote.subscription_url || config.subUrl;
      if (!url) throw new Error('SUBSCRIPTION_URL_UNAVAILABLE');
      const image = await QRCode.toBuffer(url, {
        width: 720,
        margin: 2,
        errorCorrectionLevel: 'M',
      });
      const photo = await ctx.replyWithPhoto(new InputFile(image, `${config.configUsername}.png`), {
        caption: buildScreen({
          emoji: '📷',
          title: t(ctx, 'subscription_qr_title'),
          subtitle: t(ctx, 'subscription_qr_subtitle'),
          primary: {
            emoji: '📱',
            label: t(ctx, 'subscription_qr_service_label'),
            value: `\`${sanitizeTelegramInlineCode(config.configUsername)}\``,
          },
        }),
        parse_mode: 'Markdown',
        reply_markup: dismissKeyboard(ctx),
      });
      rememberArtifactMessage(ctx.session, photo.message_id);
    } catch {
      await renderSubscriptionScreen(
        ctx,
        buildEmptyState('⚠️', t(ctx, 'subscription_qr_title'), t(ctx, 'subscription_qr_failed')),
        new InlineKeyboard().text(t(ctx, 'menu_back'), callbackData('config', 'view', config.id))
      );
    }
  });
}

async function ownedConfig(ctx: MenuContext, configId: string, answerIfMissing = true) {
  if (!ctx.services || !ctx.from) return undefined;
  const config = await ctx.services.configService.getOwnedConfigById(ctx.from.id, configId);
  if (!config && answerIfMissing) {
    await ctx.answerCallbackQuery({ text: t(ctx, 'config_not_owned'), show_alert: true });
  }
  return config;
}

async function buildSubscriptionCard(
  ctx: MenuContext,
  config: UserConfigRecord,
  isDetailView = false
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const snapshot = await buildSubscriptionSnapshot(ctx, config);
  const keyboard = buildSubscriptionActionKeyboard(
    ctx,
    config.id,
    snapshot.status,
    config.autoRenewEnabled,
    isDetailView
  );

  if (!isDetailView) {
    return {
      text: buildScreen({
        emoji: '📱',
        title: `\`${sanitizeTelegramInlineCode(config.configUsername)}\``,
        primary: {
          emoji: statusEmoji(snapshot.status),
          label: t(ctx, 'subscription_status_label'),
          value: buildStatusBadge(ctx, statusBadgeType(snapshot.status), snapshot.statusLabel),
        },
        sections: [
          {
            emoji: '📊',
            title: t(ctx, 'subscription_usage_section'),
            fields: [
              { emoji: '📶', label: t(ctx, 'remaining'), value: snapshot.remaining },
              { emoji: '⏳', label: t(ctx, 'expiry'), value: snapshot.expiryInfo },
            ],
          },
        ],
        footer: snapshot.remoteAvailable ? undefined : `⚠️ ${t(ctx, 'subscription_cached_notice')}`,
      }),
      keyboard,
    };
  }

  return {
    text: buildScreen({
      emoji: '📱',
      title: tm(ctx, 'subscription_detail_heading', { username: config.configUsername }),
      subtitle: t(
        ctx,
        snapshot.remoteAvailable
          ? 'subscription_detail_live_subtitle'
          : 'subscription_detail_cached_subtitle'
      ),
      primary: {
        emoji: statusEmoji(snapshot.status),
        label: t(ctx, 'subscription_status_label'),
        value: buildStatusBadge(ctx, statusBadgeType(snapshot.status), snapshot.statusLabel),
      },
      sections: [
        {
          emoji: '📊',
          title: t(ctx, 'subscription_usage_section'),
          fields: [
            { emoji: '📶', label: t(ctx, 'remaining'), value: snapshot.remaining },
            { emoji: '⏳', label: t(ctx, 'expiry'), value: snapshot.expiryInfo },
          ],
        },
        {
          emoji: '🔗',
          title: t(ctx, 'subscription_connection_section'),
          fields: [
            {
              emoji: '🌐',
              label: t(ctx, 'subscription_last_connection_label'),
              value: snapshot.onlineInfo,
            },
            {
              emoji: '📅',
              label: t(ctx, 'subscription_created_label'),
              value: snapshot.createdInfo,
            },
            {
              emoji: '🔗',
              label: t(ctx, 'subscription_link_label'),
              value: formatSubscriptionLink(
                snapshot.subUrl,
                t(ctx, 'subscription_link_unavailable')
              ),
            },
          ],
        },
        {
          emoji: '♻️',
          title: t(ctx, 'subscription_automation_section'),
          fields: [
            {
              emoji: config.autoRenewEnabled ? '🟢' : '⚪️',
              label: t(ctx, 'subscription_auto_renew_label'),
              value: config.autoRenewEnabled
                ? `${t(ctx, 'ui_status_active')} · ${snapshot.autoRenewPackageName ?? t(ctx, 'auto_renew_package_unavailable')}`
                : t(ctx, 'ui_status_inactive'),
            },
          ],
        },
      ],
      footer: snapshot.remoteAvailable ? undefined : `⚠️ ${t(ctx, 'subscription_cached_notice')}`,
    }),
    keyboard,
  };
}

async function buildSubscriptionSnapshot(
  ctx: MenuContext,
  config: UserConfigRecord
): Promise<SubscriptionSnapshot & { remoteAvailable: boolean }> {
  let remote: RebeccaUserDetail | undefined;
  try {
    remote = await ctx.services!.configService.getRemoteConfigDetail(config);
  } catch {
    remote = undefined;
  }

  const traffic = calculateTraffic(remote, config);
  const expire = remote?.expire ?? config.panelExpire;
  const status = effectiveStatus(
    remote?.status ?? config.panelStatus ?? 'unknown',
    traffic.remainingBytes ?? undefined,
    expire
  );
  let remaining: string;
  if (traffic.isUnavailable) {
    remaining = t(ctx, 'traffic_unavailable');
  } else if (traffic.isUnlimited) {
    remaining = t(ctx, 'unlimited');
  } else if (traffic.remainingBytes != null) {
    const gb = Number((traffic.remainingBytes / 1024 ** 3).toFixed(2));
    remaining = `${localizedNumber(gb, ctx)} ${t(ctx, 'traffic_unit_gb')}${traffic.isCached ? ' (cached)' : ''}`;
  } else {
    remaining = t(ctx, 'traffic_unavailable');
  }
  const expiryInfo = formatExpiry(ctx, expire);
  const onlineInfo = formatOnline(ctx, remote?.online_at ?? undefined);
  const subUrl = remote?.subscription_url || config.subUrl;
  const pkgOption = config.autoRenewPackageId
    ? ctx.services?.pricingService.getPackageById(config.autoRenewPackageId)
    : undefined;
  const autoRenewPackageName = pkgOption
    ? escapeTelegramMarkdown(localizedPackageName(ctx, pkgOption.id, pkgOption.name))
    : undefined;
  return {
    remoteAvailable: remote !== undefined,
    status,
    statusLabel: localizedSubscriptionStatusLabel(ctx, status),
    remaining,
    expiryInfo,
    onlineInfo,
    createdInfo: localizedDate(new Date(remote?.created_at || config.createdAt), ctx),
    subUrl: subUrl ?? undefined,
    autoRenewPackageName,
  };
}

/** Action keyboard for a single subscription detail screen. */
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
        t(ctx, 'subscription_view_detail', undefined) || '👁 جزئیات',
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
      callbackData('config', 'set', status === 'disabled' ? 'on' : 'off', configId)
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

function localizedSubscriptionStatusLabel(ctx: MenuContext, status: string): string {
  const key = `subscription_state_${status}`;
  const translated = t(ctx, key);
  return translated === key ? t(ctx, 'subscription_state_unknown', { status }) : translated;
}

function statusBadgeType(status: string): StatusType {
  if (status === 'active') return 'active';
  if (status === 'disabled') return 'inactive';
  if (status === 'on_hold') return 'pending';
  if (status === 'expired' || status === 'depleted') return 'expired';
  return 'warning';
}

function statusEmoji(status: string): string {
  if (status === 'active') return '🟢';
  if (status === 'disabled') return '⚪️';
  if (status === 'on_hold') return '⏳';
  if (status === 'expired' || status === 'depleted') return '⌛';
  return '⚠️';
}

function buildRenewalCheckoutScreen(
  ctx: MenuContext,
  input: {
    username: string;
    gbAmount: number;
    durationDays: number;
    amount: number;
    pricePerGb: number;
    promoCode?: string;
  }
): string {
  return buildScreen({
    emoji: '🔄',
    title: t(ctx, 'renewal_review_title'),
    subtitle: t(ctx, 'renewal_review_subtitle'),
    primary: {
      emoji: '💰',
      label: t(ctx, 'checkout_total_label'),
      value: `${localizedNumber(input.amount, ctx)} ${t(ctx, 'currency_toman')}`,
    },
    sections: [
      {
        emoji: '📱',
        title: t(ctx, 'renewal_selection_service_label'),
        fields: [
          {
            emoji: '🆔',
            label: t(ctx, 'checkout_service_label'),
            value: `\`${sanitizeTelegramInlineCode(input.username)}\``,
          },
        ],
      },
      {
        emoji: '📦',
        title: t(ctx, 'checkout_package_section'),
        fields: [
          {
            emoji: '📊',
            label: t(ctx, 'checkout_traffic_label'),
            value: `${localizedNumber(input.gbAmount, ctx)} ${t(ctx, 'traffic_unit_gb')}`,
          },
          {
            emoji: '⏳',
            label: t(ctx, 'checkout_duration_label'),
            value: `${localizedNumber(input.durationDays, ctx)} ${t(ctx, 'days_unit')}`,
          },
          {
            emoji: '💳',
            label: t(ctx, 'checkout_unit_price_label'),
            value: `${localizedNumber(input.pricePerGb, ctx)} ${t(ctx, 'currency_toman')}`,
          },
        ],
      },
      ...(input.promoCode
        ? [
            {
              emoji: '🎟️',
              title: t(ctx, 'checkout_promo_section'),
              fields: [
                {
                  emoji: '🎟️',
                  label: t(ctx, 'shop_promo_section'),
                  value: `\`${sanitizeTelegramInlineCode(input.promoCode)}\``,
                },
              ],
            },
          ]
        : []),
    ],
    footer: `ℹ️ ${t(ctx, 'checkout_confirmation_hint')}`,
  });
}

function buildDeleteReviewScreen(
  ctx: MenuContext,
  config: UserConfigRecord,
  quote: DeleteQuote
): string {
  const refundValue = quote.eligible
    ? `${localizedNumber(quote.refundAmount, ctx)} ${t(ctx, 'currency_toman')}`
    : undefined;
  return buildScreen({
    emoji: '🗑️',
    title: t(ctx, 'config_delete_review_title'),
    subtitle: t(
      ctx,
      quote.eligible ? 'config_delete_refund_subtitle' : 'config_delete_no_refund_subtitle'
    ),
    primary: quote.eligible
      ? {
          emoji: '💸',
          label: t(ctx, 'config_delete_refund_label'),
          value: refundValue!,
        }
      : {
          emoji: '⚠️',
          label: t(ctx, 'config_delete_eligibility_label'),
          value: t(ctx, `refund_reason_${quote.reason}`),
        },
    sections: [
      {
        emoji: '📱',
        title: t(ctx, 'config_delete_service_label'),
        fields: [
          {
            emoji: '🆔',
            label: t(ctx, 'checkout_service_label'),
            value: `\`${sanitizeTelegramInlineCode(config.configUsername)}\``,
          },
        ],
      },
      ...(quote.eligible
        ? [
            {
              emoji: '💰',
              title: t(ctx, 'config_delete_refund_label'),
              fields: [
                {
                  emoji: '💳',
                  label: t(ctx, 'config_delete_original_charge_label'),
                  value: `${localizedNumber(quote.grossAmount, ctx)} ${t(ctx, 'currency_toman')}`,
                },
                {
                  emoji: '🎁',
                  label: t(ctx, 'config_delete_cashback_label'),
                  value: `${localizedNumber(quote.cashbackWithheld, ctx)} ${t(ctx, 'currency_toman')}`,
                },
                {
                  emoji: '💸',
                  label: t(ctx, 'config_delete_refund_label'),
                  value: refundValue!,
                },
              ],
            },
          ]
        : []),
    ],
    footer: quote.eligible
      ? `⚠️ ${t(ctx, 'config_delete_refund_consequence')}`
      : `⚠️ ${t(ctx, 'config_delete_no_refund_consequence')}`,
  });
}

function buildDeleteResultScreen(
  ctx: MenuContext,
  username: string,
  refundAmount: number | undefined,
  refunded: boolean
): string {
  return buildScreen({
    emoji: '✅',
    title: t(ctx, 'config_delete_success_title'),
    subtitle: t(
      ctx,
      refunded
        ? 'config_delete_success_refund_subtitle'
        : 'config_delete_success_no_refund_subtitle'
    ),
    primary: refunded
      ? {
          emoji: '💸',
          label: t(ctx, 'config_delete_refund_label'),
          value: `${localizedNumber(refundAmount ?? 0, ctx)} ${t(ctx, 'currency_toman')}`,
        }
      : {
          emoji: '🗑️',
          label: t(ctx, 'config_delete_service_label'),
          value: `\`${sanitizeTelegramInlineCode(username)}\``,
        },
    ...(refunded
      ? {
          sections: [
            {
              emoji: '📱',
              title: t(ctx, 'config_delete_service_label'),
              fields: [
                {
                  emoji: '🆔',
                  label: t(ctx, 'checkout_service_label'),
                  value: `\`${sanitizeTelegramInlineCode(username)}\``,
                },
              ],
            },
          ],
        }
      : {}),
  });
}

async function renderSubscriptionScreen(
  ctx: MenuContext,
  text: string,
  keyboard: InlineKeyboard
): Promise<void> {
  await renderUiScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: keyboard });
}
