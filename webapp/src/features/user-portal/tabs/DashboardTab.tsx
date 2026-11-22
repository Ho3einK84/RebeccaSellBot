import React from 'react';
import {
  Wallet,
  ShoppingBag,
  Wifi,
  Users,
  CreditCard,
  MessageCircle,
  ChevronLeft,
  ShieldCheck,
  Activity,
  History,
  Copy,
  Check,
  RefreshCw,
} from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import type {
  UserPortalProfile,
  UserPortalSettings,
  UserConfigRecord,
  UserTransactionRecord,
  UserTabType,
} from '@/shared/types/userPortal.js';
import {
  ServiceStatusDot,
  ServiceStatusBadge,
  ServiceAutoRenewBadge,
  ServiceTrafficBar,
} from '@/features/user-portal/components/ServiceStatusTraffic.js';
import { TransactionItem } from '@/features/user-portal/components/TransactionItem.js';
import { Button } from '@/shared/components/ui/Button.js';
import { Card } from '@/shared/components/ui/Card.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { SectionHeader } from '@/shared/components/ui/SectionHeader.js';
import { EmptyState } from '@/shared/components/ui/EmptyState.js';
import { useToast } from '@/shared/components/ui/Toast.js';

interface DashboardTabProps {
  profile: UserPortalProfile | null;
  settings: UserPortalSettings | null;
  configs: UserConfigRecord[];
  transactions: UserTransactionRecord[];
  onSwitchTab: (tab: UserTabType) => void;
  onOpenService?: (configId: string) => void;
  onRenewConfig?: (config: UserConfigRecord) => void;
}

export const DashboardTab: React.FC<DashboardTabProps> = ({
  profile,
  settings,
  configs,
  transactions,
  onSwitchTab,
  onOpenService,
  onRenewConfig,
}) => {
  const { t } = useLanguage();
  const { triggerHaptic } = useHaptic();
  const { formatToman, formatNumber } = useFormatters();
  const { copy, isCopied } = useCopy();
  const { notify } = useToast();

  const currency = settings?.currency || t('common.currency');
  const availableBalance = profile?.availableBalance ?? 0;
  const activeConfigs = configs.filter(
    (c) => c.panelStatus === 'active' || c.panelStatus === 'on_hold'
  );
  const needsAttentionConfigs = configs.filter(
    (c) => c.panelStatus === 'expired' || c.panelStatus === 'limited'
  );
  const displayedConfigs =
    activeConfigs.length > 0 ? activeConfigs.slice(0, 2) : configs.slice(0, 2);
  const showingAttentionOnly = activeConfigs.length === 0 && configs.length > 0;

  const formatShortRefCode = (code?: string | null) => {
    if (!code) return '—';
    if (code.length <= 14) return code;
    return `${code.slice(0, 8)}...${code.slice(-4)}`;
  };

  const handleCopyReferral = async () => {
    if (!profile?.referralCode) return;
    triggerHaptic('light');
    const ok = await copy(profile.referralCode, 'dashboard-ref-code');
    if (ok) {
      notify(t('user.referral.codeCopied'), 'success');
    }
  };

  const handleAction = (tab: UserTabType) => {
    triggerHaptic('light');
    onSwitchTab(tab);
  };

  const handleSupportClick = () => {
    triggerHaptic('medium');
    const supportUser = (settings?.supportUsername || '').trim();
    if (!supportUser) return;

    let url = supportUser;
    if (!/^https?:\/\//i.test(supportUser)) {
      const cleanUsername = supportUser.replace(/^@/, '');
      url = `https://t.me/${cleanUsername}`;
    }

    if (window.Telegram?.WebApp?.openTelegramLink) {
      window.Telegram.WebApp.openTelegramLink(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-5 items-start pb-6">
      {/* Left column: Anodized Balance Instrument, Quick Actions, Support */}
      <div className="lg:col-span-7 flex flex-col gap-4">
        <section
          aria-label={t('user.dashboard.walletBalance')}
          className="relative overflow-hidden rounded-card rs-hero-obsidian text-obsidian-ink p-5 sm:p-6"
        >
          {/* Technical hairline corner mark — crisp vector precision, no blur glow */}
          <svg
            aria-hidden="true"
            viewBox="0 0 120 120"
            className="pointer-events-none absolute -bottom-5 -end-5 w-36 h-36 text-white/[0.045]"
            fill="none"
          >
            <circle cx="60" cy="60" r="54" stroke="currentColor" strokeWidth="1" />
            <circle cx="60" cy="60" r="36" stroke="currentColor" strokeWidth="1" />
            <path d="M6 60h108M60 6v108" stroke="currentColor" strokeWidth="1" />
          </svg>

          <div className="relative z-10 flex flex-col justify-between min-h-[144px]">
            {/* Top row */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-6 rounded-md bg-white/[0.08] border border-white/15 flex items-center justify-center shrink-0">
                  <CreditCard className="w-3.5 h-3.5 text-white/80" aria-hidden="true" />
                </span>
                <span className="text-xs font-medium text-white/75">
                  {t('user.dashboard.walletBalance')}
                </span>
              </div>

              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/[0.08] border border-white/15 text-[11px] font-medium text-white/85 tnum">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    activeConfigs.length > 0
                      ? 'bg-emerald-400 ring-2 ring-emerald-400/25'
                      : 'bg-white/45'
                  }`}
                  aria-hidden="true"
                />
                <span>
                  {activeConfigs.length > 0
                    ? `${formatNumber(activeConfigs.length)} ${t('user.services.statusActive')}`
                    : t('user.serviceOnlineStatus')}
                </span>
              </span>
            </div>

            {/* Balance Figure */}
            <div className="my-4 text-start">
              <div className="flex items-baseline gap-2 flex-wrap">
                <bdi dir="ltr" className="text-2xl sm:text-3xl font-semibold tnum text-white">
                  {formatToman(availableBalance)}
                </bdi>
                <span className="text-xs sm:text-sm font-medium text-white/65">{currency}</span>
              </div>
            </div>

            {/* Bottom Toolbar: Referral Code & Top-up */}
            <div className="flex items-center justify-between gap-3 pt-3.5 border-t border-white/10 flex-wrap">
              <div className="flex flex-col min-w-0 text-start">
                <span className="text-[11px] text-white/60 leading-tight mb-1">
                  {t('user.referral.yourCode')}
                </span>
                <div className="flex items-center gap-1.5 min-w-0">
                  <bdi
                    dir="ltr"
                    className="text-xs font-mono font-medium text-white/90 truncate"
                    title={profile?.referralCode || ''}
                  >
                    {formatShortRefCode(profile?.referralCode)}
                  </bdi>
                  {profile?.referralCode && (
                    <button
                      type="button"
                      onClick={() => void handleCopyReferral()}
                      className="w-7 h-7 rounded-ctl bg-white/10 hover:bg-white/15 flex items-center justify-center press rs-focus text-white/85 shrink-0 cursor-pointer"
                      title={t('common.copy')}
                      aria-label={t('common.copy')}
                    >
                      {isCopied('dashboard-ref-code') ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400 anim-pop" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>
              </div>

              <Button
                size="sm"
                variant="primary"
                onClick={() => handleAction('wallet')}
                className="shrink-0"
              >
                <Wallet className="w-3.5 h-3.5 shrink-0" />
                <span>{t('user.dashboard.quickTopup')}</span>
              </Button>
            </div>
          </div>
        </section>

        {/* Quick Action Grid */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 anim-stagger">
          <button
            type="button"
            onClick={() => handleAction('shop')}
            className="group rs-card-interactive rounded-tile border border-line bg-surface hover:bg-surface-2 p-3.5 flex flex-col items-center justify-center gap-2 text-center press rs-focus cursor-pointer shadow-[var(--shadow-card)]"
          >
            <IconTile tone="brand" size="md">
              <ShoppingBag />
            </IconTile>
            <span className="text-xs font-medium text-ink">{t('user.dashboard.buyService')}</span>
          </button>

          <button
            type="button"
            onClick={() => handleAction('services')}
            className="group rs-card-interactive rounded-tile border border-line bg-surface hover:bg-surface-2 p-3.5 flex flex-col items-center justify-center gap-2 text-center press rs-focus cursor-pointer shadow-[var(--shadow-card)]"
          >
            <IconTile tone="ok" size="md">
              <Wifi />
            </IconTile>
            <span className="text-xs font-medium text-ink">{t('user.dashboard.myConfigs')}</span>
          </button>

          <button
            type="button"
            onClick={() => handleAction('wallet')}
            className="group rs-card-interactive rounded-tile border border-line bg-surface hover:bg-surface-2 p-3.5 flex flex-col items-center justify-center gap-2 text-center press rs-focus cursor-pointer shadow-[var(--shadow-card)]"
          >
            <IconTile tone="warn" size="md">
              <Wallet />
            </IconTile>
            <span className="text-xs font-medium text-ink">{t('user.tabs.wallet')}</span>
          </button>

          <button
            type="button"
            onClick={() => handleAction('referral')}
            className="group rs-card-interactive rounded-tile border border-line bg-surface hover:bg-surface-2 p-3.5 flex flex-col items-center justify-center gap-2 text-center press rs-focus cursor-pointer shadow-[var(--shadow-card)]"
          >
            <IconTile tone="accent" size="md">
              <Users />
            </IconTile>
            <span className="text-xs font-medium text-ink">{t('user.dashboard.inviteEarn')}</span>
          </button>
        </section>

        {/* Support Card */}
        {settings?.supportEnabled !== false && Boolean(settings?.supportUsername) && (
          <button
            type="button"
            onClick={handleSupportClick}
            className="group rs-card-interactive w-full rounded-tile border border-brand/25 bg-gradient-to-l from-brand-soft via-brand-soft/80 to-accent-soft/45 p-3.5 flex items-center justify-between gap-3 text-start press rs-focus cursor-pointer shadow-[var(--shadow-card)]"
          >
            <div className="flex items-center gap-3 min-w-0">
              <IconTile tone="brand" size="md">
                <MessageCircle />
              </IconTile>
              <div className="flex flex-col min-w-0">
                <span className="text-[13px] font-semibold text-ink">
                  {t('user.dashboard.supportHelp')}
                </span>
                <span className="mt-0.5 text-xs leading-snug text-ink-muted">
                  {t('user.dashboard.supportSub')}
                </span>
              </div>
            </div>
            <ChevronLeft
              className="w-4 h-4 shrink-0 text-brand-fg ltr:rotate-180 transition-transform duration-200 group-hover:-translate-x-0.5 ltr:group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </button>
        )}
      </div>

      {/* Right column: Active Services + Recent Activity Ledger */}
      <div className="lg:col-span-5 flex flex-col gap-5">
        <section className="w-full">
          <SectionHeader
            icon={<Activity />}
            title={
              showingAttentionOnly
                ? t('user.dashboard.servicesNeedAttention')
                : t('user.dashboard.activeServices')
            }
            count={formatNumber(showingAttentionOnly ? configs.length : activeConfigs.length)}
            actionLabel={configs.length > 0 ? t('common.all') : undefined}
            onAction={configs.length > 0 ? () => handleAction('services') : undefined}
            className="mb-2.5"
          />

          {configs.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck />}
              tone="brand"
              title={t('user.services.emptyTitle')}
              description={t('user.services.emptyDesc')}
              action={
                <Button size="sm" onClick={() => handleAction('shop')}>
                  {t('user.services.buyFirst')}
                </Button>
              }
            />
          ) : (
            <div className="flex flex-col gap-2.5 anim-stagger">
              {showingAttentionOnly && needsAttentionConfigs.length > 0 && (
                <div className="rounded-tile border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn-fg leading-relaxed">
                  {t('user.dashboard.expiredServicesNotice')}
                </div>
              )}

              {displayedConfigs.map((cfg) => {
                const isAttention = cfg.panelStatus === 'expired' || cfg.panelStatus === 'limited';
                return (
                  <div
                    key={cfg.id}
                    className={`rounded-card border bg-surface p-3.5 flex flex-col gap-2.5 text-start shadow-[var(--shadow-card)] ${
                      isAttention ? 'border-warn/40' : 'border-line'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic('selection');
                        if (onOpenService) {
                          onOpenService(cfg.id);
                        } else {
                          onSwitchTab('services');
                        }
                      }}
                      className="w-full flex flex-col gap-2.5 text-start cursor-pointer rs-focus rounded-ctl"
                    >
                      <div className="flex items-center justify-between w-full gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <ServiceStatusDot status={cfg.panelStatus} />
                          <bdi
                            dir="ltr"
                            className="text-[13px] font-mono font-medium truncate text-ink"
                          >
                            {cfg.configUsername}
                          </bdi>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <ServiceAutoRenewBadge enabled={cfg.autoRenewEnabled} />
                          <ServiceStatusBadge status={cfg.panelStatus} />
                        </div>
                      </div>

                      <ServiceTrafficBar
                        dataLimit={cfg.panelDataLimit}
                        usedTraffic={cfg.panelUsedTraffic}
                        compact
                      />
                    </button>

                    {isAttention && onRenewConfig && (
                      <Button
                        size="sm"
                        variant="primary"
                        block
                        onClick={() => {
                          triggerHaptic('medium');
                          onRenewConfig(cfg);
                        }}
                      >
                        <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                        <span>{t('user.services.renewQuick')}</span>
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="w-full">
          <SectionHeader
            icon={<History />}
            title={t('user.dashboard.recentActivity')}
            actionLabel={transactions.length > 0 ? t('common.all') : undefined}
            onAction={transactions.length > 0 ? () => handleAction('wallet') : undefined}
            className="mb-2.5"
          />

          {transactions.length === 0 ? (
            <Card padding="md" className="text-center text-xs text-ink-muted">
              {t('user.dashboard.noRecentActivity')}
            </Card>
          ) : (
            <div className="flex flex-col gap-2 anim-stagger">
              {transactions.slice(0, 3).map((tx) => (
                <TransactionItem key={tx.id} tx={tx} currency={currency} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
