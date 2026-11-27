import type { MenuContext } from '../types.js';
import { localizedNumber, t, tm } from '../locale.js';
import { escapeTelegramMarkdown } from '../rendering.js';
import { buildStatusBadge, buildUserScreen } from '../ui.js';
import { formatUserVersionFooter } from '../versionBadge.js';
import {
  formatUserGroupDisplayLabel,
  safeGetEffectiveUserPolicy,
} from '../../domain/services/UserGroupService.js';

/** Render the personalized, failure-aware home dashboard. */
export async function renderHomeDashboard(ctx: MenuContext): Promise<string> {
  const telegramId = ctx.from?.id;
  if (!telegramId || !ctx.services) return t(ctx, 'main_menu');

  let balance: number;
  let availableBalance: number;
  let activeCount = 0;
  let totalConfigsCount = 0;
  let servicesAvailable = true;
  let nearExpiryInfo: { username: string; userLabel?: string | null; daysLeft: number } | undefined;

  const groupPolicy = await safeGetEffectiveUserPolicy(ctx.services.userGroupService, telegramId);

  try {
    const [fetchedBalance, fetchedAvailable, configs] = await Promise.all([
      ctx.services.walletService.getBalance(telegramId),
      typeof ctx.services.walletService.getAvailableBalance === 'function'
        ? ctx.services.walletService.getAvailableBalance(telegramId)
        : ctx.services.walletService.getBalance(telegramId),
      ctx.services.configService.listConfigsForOwner(telegramId),
    ]);
    balance = fetchedBalance;
    availableBalance = fetchedAvailable;
    totalConfigsCount = configs.length;
    const now = Math.floor(Date.now() / 1000);
    const activeConfigs = configs.filter(
      (config) =>
        config.panelStatus === 'active' && (config.panelExpire == null || config.panelExpire > now)
    );
    activeCount = activeConfigs.length;

    const expiring = activeConfigs
      .filter((config) => config.panelExpire != null)
      .map((config) => ({
        username: config.configUsername,
        userLabel: config.userLabel ?? null,
        daysLeft: Math.ceil((config.panelExpire! - now) / 86400),
      }))
      .filter((item) => item.daysLeft <= 3)
      .sort((a, b) => a.daysLeft - b.daysLeft)[0];
    nearExpiryInfo = expiring;
  } catch {
    servicesAvailable = false;
    balance = await ctx.services.walletService.getBalance(telegramId).catch(() => 0);
    availableBalance = balance;
  }

  const groupLabel = formatUserGroupDisplayLabel(groupPolicy);
  const currency = t(ctx, 'currency_toman');
  const debtAmount = Math.max(0, -balance);
  const purchasingPower = Math.max(0, availableBalance + groupPolicy.creditLimit);
  const showCreditInfo = groupPolicy.creditLimit > 0 || balance < 0;

  const notices: string[] = [];
  if (!servicesAvailable) {
    notices.push(`⚠️ ${t(ctx, 'home_services_unavailable_hint')}`);
  } else if (activeCount === 0) {
    if (totalConfigsCount > 0) {
      notices.push(`⌛ ${t(ctx, 'home_has_expired_services_hint')}`);
    } else {
      notices.push(`📭 ${t(ctx, 'home_no_active_services_hint')}`);
    }
  }
  if (nearExpiryInfo) {
    const labelSuffix = nearExpiryInfo.userLabel?.trim()
      ? `\n🏷️ ${escapeTelegramMarkdown(nearExpiryInfo.userLabel.trim())}`
      : '';
    notices.push(
      `${buildStatusBadge(ctx, 'warning', t(ctx, 'home_near_expiry_warning'))}\n${tm(
        ctx,
        'home_near_expiry_detail',
        {
          username: nearExpiryInfo.username,
          days: localizedNumber(nearExpiryInfo.daysLeft, ctx),
          days_unit: t(ctx, 'days_unit'),
        }
      )}${labelSuffix}`
    );
  }

  const overviewFields = [
    ...(groupLabel
      ? [
          {
            emoji: '🏷️',
            label: t(ctx, 'user_group_badge_label'),
            value: escapeTelegramMarkdown(groupLabel),
          },
        ]
      : []),
    ...(debtAmount > 0
      ? [
          {
            emoji: '🔻',
            label: t(ctx, 'wallet_debt_label'),
            value: `${localizedNumber(debtAmount, ctx)} ${currency}`,
          },
        ]
      : []),
    ...(showCreditInfo
      ? [
          {
            emoji: '💎',
            label: t(ctx, 'wallet_credit_limit_label'),
            value: `${localizedNumber(groupPolicy.creditLimit, ctx)} ${currency}`,
          },
          {
            emoji: '🛒',
            label: t(ctx, 'wallet_purchasing_power_label'),
            value: `${localizedNumber(purchasingPower, ctx)} ${currency}`,
          },
        ]
      : []),
    {
      emoji: servicesAvailable ? (activeCount > 0 ? '🟢' : '⚪️') : '⚠️',
      label: t(ctx, 'home_active_services'),
      value: servicesAvailable
        ? `${localizedNumber(activeCount, ctx)} ${t(ctx, 'service_unit')}`
        : t(ctx, 'ui_status_error'),
    },
  ];

  return buildUserScreen({
    emoji: '🏠',
    title: t(ctx, 'home_title'),
    subtitle: t(ctx, 'home_subtitle'),
    primary: {
      emoji: '💳',
      label: t(ctx, 'home_balance'),
      value: `${localizedNumber(balance, ctx)} ${currency}`,
      emphasizeValue: true,
    },
    sections: [
      {
        emoji: '📡',
        title: t(ctx, 'home_service_overview'),
        fields: overviewFields,
      },
    ],
    footer: [...notices, formatUserVersionFooter(ctx)].filter(Boolean).join('\n\n'),
  });
}
