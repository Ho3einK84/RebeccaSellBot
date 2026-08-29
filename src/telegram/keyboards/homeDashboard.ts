import type { MenuContext } from '../types.js';
import { localizedNumber, t, tm } from '../locale.js';
import { buildScreen, buildStatusBadge } from '../ui.js';

/** Render the personalized, failure-aware home dashboard. */
export async function renderHomeDashboard(ctx: MenuContext): Promise<string> {
  const telegramId = ctx.from?.id;
  if (!telegramId || !ctx.services) return t(ctx, 'main_menu');

  let balance: number;
  let activeCount = 0;
  let totalConfigsCount = 0;
  let servicesAvailable = true;
  let nearExpiryInfo: { username: string; daysLeft: number } | undefined;

  try {
    const [fetchedBalance, configs] = await Promise.all([
      ctx.services.walletService.getBalance(telegramId),
      ctx.services.configService.listConfigsForOwner(telegramId),
    ]);
    balance = fetchedBalance;
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
        daysLeft: Math.ceil((config.panelExpire! - now) / 86400),
      }))
      .filter((item) => item.daysLeft <= 3)
      .sort((a, b) => a.daysLeft - b.daysLeft)[0];
    nearExpiryInfo = expiring;
  } catch {
    servicesAvailable = false;
    balance = await ctx.services.walletService.getBalance(telegramId).catch(() => 0);
  }

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
    notices.push(
      `${buildStatusBadge(ctx, 'warning', t(ctx, 'home_near_expiry_warning'))}\n${tm(
        ctx,
        'home_near_expiry_detail',
        {
          username: nearExpiryInfo.username,
          days: localizedNumber(nearExpiryInfo.daysLeft, ctx),
          days_unit: t(ctx, 'days_unit'),
        }
      )}`
    );
  }

  return buildScreen({
    emoji: '🏠',
    title: t(ctx, 'home_title'),
    subtitle: t(ctx, 'home_subtitle'),
    primary: {
      emoji: '👛',
      label: t(ctx, 'home_balance'),
      value: `${localizedNumber(balance, ctx)} ${t(ctx, 'currency_toman')}`,
    },
    sections: [
      {
        emoji: '📱',
        title: t(ctx, 'home_service_overview'),
        fields: [
          {
            emoji: servicesAvailable ? (activeCount > 0 ? '🟢' : '⚪️') : '⚠️',
            label: t(ctx, 'home_active_services'),
            value: servicesAvailable
              ? `${localizedNumber(activeCount, ctx)} ${t(ctx, 'service_unit')}`
              : t(ctx, 'ui_status_error'),
          },
        ],
      },
    ],
    footer: notices.join('\n\n'),
  });
}
