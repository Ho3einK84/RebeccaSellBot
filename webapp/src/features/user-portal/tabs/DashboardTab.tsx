import React from 'react';
import {
  Wallet,
  ShoppingBag,
  Wifi,
  Gift,
  CreditCard,
  MessageCircle,
  ChevronLeft,
  ShieldCheck,
  Activity,
  History,
  Copy,
  Check,
  RefreshCw,
  Sparkles,
  AlertTriangle,
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
  UserTrialStatus,
  LuckyWheelSummary,
  TrialClaimResponse,
} from '@/shared/types/userPortal.js';
import {
  ServiceStatusDot,
  ServiceStatusBadge,
  ServiceAutoRenewBadge,
  ServiceTrafficBar,
} from '@/features/user-portal/components/ServiceStatusTraffic.js';
import { TransactionItem } from '@/features/user-portal/components/TransactionItem.js';
import { FreeTrialBanner } from '@/features/user-portal/components/FreeTrialSection.js';
import { Button } from '@/shared/components/ui/Button.js';
import { Card } from '@/shared/components/ui/Card.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { SectionHeader } from '@/shared/components/ui/SectionHeader.js';
import { EmptyState } from '@/shared/components/ui/EmptyState.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { useToast } from '@/shared/components/ui/Toast.js';

interface DashboardTabProps {
  profile: UserPortalProfile | null;
  settings: UserPortalSettings | null;
  trial?: UserTrialStatus | null;
  luckyWheel?: LuckyWheelSummary | null;
  configs: UserConfigRecord[];
  transactions: UserTransactionRecord[];
  onSwitchTab: (tab: UserTabType) => void;
  onOpenService?: (configId: string) => void;
  onRenewConfig?: (config: UserConfigRecord) => void;
  onTrialClaimed?: (res: TrialClaimResponse) => void;
  onNotify?: (message: string, type?: 'success' | 'error') => void;
}

function isConfigTrulyActive(cfg: UserConfigRecord, nowSec: number): boolean {
  if (cfg.panelStatus === 'on_hold') return true;
  if (cfg.panelStatus !== 'active') return false;
  if (typeof cfg.panelExpire === 'number' && cfg.panelExpire > 0 && cfg.panelExpire <= nowSec) {
    return false;
  }
  return true;
}

function isConfigUrgent(cfg: UserConfigRecord, nowSec: number): boolean {
  if (cfg.panelStatus === 'expired' || cfg.panelStatus === 'limited') return true;
  if (
    cfg.panelStatus === 'active' &&
    typeof cfg.panelExpire === 'number' &&
    cfg.panelExpire > 0 &&
    cfg.panelExpire - nowSec <= 3 * 86_400
  ) {
    return true;
  }
  if (
    cfg.panelStatus === 'active' &&
    typeof cfg.panelDataLimit === 'number' &&
    cfg.panelDataLimit > 0 &&
    typeof cfg.panelUsedTraffic === 'number' &&
    cfg.panelUsedTraffic / cfg.panelDataLimit >= 0.85
  ) {
    return true;
  }
  return false;
}

function formatShortCountdown(seconds: number | null, locale: string): string {
  if (!seconds || seconds <= 0) return locale === 'fa' ? 'به‌زودی' : 'soon';
  const totalMins = Math.ceil(seconds / 60);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  const numLoc = locale === 'fa' ? 'fa-IR' : 'en-US';
  if (hrs > 0 && mins > 0) {
    return locale === 'fa'
      ? `${hrs.toLocaleString(numLoc)} ساعت و ${mins.toLocaleString(numLoc)} دقیقه`
      : `${hrs}h ${mins}m`;
  }
  if (hrs > 0) {
    return locale === 'fa' ? `${hrs.toLocaleString(numLoc)} ساعت` : `${hrs}h`;
  }
  return locale === 'fa' ? `${mins.toLocaleString(numLoc)} دقیقه` : `${mins}m`;
}

export const DashboardTab: React.FC<DashboardTabProps> = ({
  profile,
  settings,
  trial,
  luckyWheel,
  configs,
  transactions,
  onSwitchTab,
  onOpenService,
  onRenewConfig,
  onTrialClaimed,
  onNotify,
}) => {
  const { t, locale } = useLanguage();
  const { triggerHaptic } = useHaptic();
  const { formatToman, formatNumber } = useFormatters();
  const { copy, isCopied } = useCopy();
  const { notify: toastNotify } = useToast();

  const notify = onNotify ?? toastNotify;
  const currency = settings?.currency || t('common.currency');
  const availableBalance = profile?.availableBalance ?? 0;
  const creditLimit = profile?.creditLimit ?? 0;
  const debtAmount = profile?.debtAmount ?? Math.max(0, -(profile?.balance ?? 0));
  const purchasingPower = profile?.purchasingPower ?? Math.max(0, availableBalance + creditLimit);
  const groupLabel = profile?.group
    ? [profile.group.badge, profile.group.name].filter(Boolean).join(' ').trim()
    : '';
  const showCreditInfo = creditLimit > 0 || debtAmount > 0 || availableBalance < 0;
  const nowSec = Math.floor(Date.now() / 1000);

  const activeConfigs = configs.filter((c) => isConfigTrulyActive(c, nowSec));
  const urgentConfigs = configs.filter((c) => isConfigUrgent(c, nowSec));

  // Prioritize urgent services first, then active services
  const displayedConfigs =
    urgentConfigs.length > 0
      ? [
          ...urgentConfigs.slice(0, 2),
          ...activeConfigs.filter((c) => !urgentConfigs.some((u) => u.id === c.id)),
        ].slice(0, 2)
      : activeConfigs.length > 0
        ? activeConfigs.slice(0, 2)
        : configs.slice(0, 2);

  const cleanBotUsername = (settings?.botUsername || '').replace(/^@/, '').trim();
  const inviteLink =
    profile?.referralCode && cleanBotUsername
      ? `https://t.me/${cleanBotUsername}?start=${profile.referralCode}`
      : profile?.referralCode || '';

  const formatShortRefCode = (code?: string | null) => {
    if (!code) return '—';
    if (code.length <= 14) return code;
    return `${code.slice(0, 8)}...${code.slice(-4)}`;
  };

  const handleCopyReferral = async () => {
    if (!inviteLink) return;
    triggerHaptic('light');
    const ok = await copy(inviteLink, 'dashboard-ref-code');
    if (ok) {
      notify(
        cleanBotUsername ? t('user.referral.linkCopied') : t('user.referral.codeCopied'),
        'success'
      );
    }
  };

  const handleAction = (tab: UserTabType) => {
    triggerHaptic('light');
    onSwitchTab(tab);
  };

  const supportUrl =
    settings?.supportUrl ||
    (settings?.supportUsername
      ? `https://t.me/${settings.supportUsername.replace(/^@/, '').trim()}`
      : '');

  const handleSupportClick = () => {
    triggerHaptic('medium');
    if (!supportUrl) return;

    if (
      (supportUrl.startsWith('https://t.me/') || supportUrl.startsWith('tg://')) &&
      window.Telegram?.WebApp?.openTelegramLink
    ) {
      window.Telegram.WebApp.openTelegramLink(supportUrl);
    } else if (window.Telegram?.WebApp?.openLink) {
      window.Telegram.WebApp.openLink(supportUrl);
    } else {
      window.open(supportUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const showWheelShortcut =
    Boolean(luckyWheel?.enabled) && (luckyWheel?.canSpin || (luckyWheel?.spinsRemaining ?? 0) > 0);

  return (
    <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-5 items-start pb-6">
      {/* Left column: Apple Card Balance Hero, Trial/Wheel Cards, Control Center Quick Actions, Support */}
      <div className="lg:col-span-7 flex flex-col gap-4">
        <section
          aria-label={t('user.dashboard.walletBalance')}
          className="relative overflow-hidden rounded-card rs-hero-obsidian text-obsidian-ink p-4 sm:p-5"
        >
          {/* Signature Geometric Orbital Radar Artwork */}
          <svg
            aria-hidden="true"
            viewBox="0 0 160 160"
            className="pointer-events-none absolute -bottom-8 -end-8 w-44 h-44 sm:w-48 sm:h-48 text-white/[0.07]"
            fill="none"
          >
            <circle cx="80" cy="80" r="72" stroke="currentColor" strokeWidth="1" />
            <circle
              cx="80"
              cy="80"
              r="56"
              stroke="currentColor"
              strokeWidth="1"
              strokeDasharray="3 4"
            />
            <circle cx="80" cy="80" r="40" stroke="currentColor" strokeWidth="1" />
            <circle
              cx="80"
              cy="80"
              r="24"
              stroke="currentColor"
              strokeWidth="1"
              strokeDasharray="2 3"
            />
            <circle cx="80" cy="80" r="8" stroke="currentColor" strokeWidth="1.2" />
            <path d="M4 80h152M80 4v152" stroke="currentColor" strokeWidth="1" />
            <path
              d="M26 26l108 108M134 26L26 134"
              stroke="currentColor"
              strokeWidth="0.75"
              strokeOpacity="0.65"
            />
            <circle cx="80" cy="24" r="2.5" fill="currentColor" fillOpacity="0.8" />
            <circle cx="40" cy="80" r="2" fill="currentColor" fillOpacity="0.7" />
            <circle cx="119" cy="41" r="2" fill="currentColor" fillOpacity="0.6" />
          </svg>

          <div className="relative z-10 flex flex-col justify-between min-h-[138px]">
            {/* Top row */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="w-8 h-6 rounded-[7px] bg-white/[0.09] border border-white/15 flex items-center justify-center shrink-0">
                  <CreditCard className="w-3.5 h-3.5 text-white/85" aria-hidden="true" />
                </span>
                <span className="text-xs font-medium text-white/80">
                  {t('user.dashboard.walletBalance')}
                </span>
                {groupLabel ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-400/20 border border-amber-300/35 text-[10px] font-semibold text-amber-200">
                    {groupLabel}
                  </span>
                ) : null}
              </div>

              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/[0.09] border border-white/15 text-[11px] font-medium text-white/90 tnum backdrop-blur-md">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    activeConfigs.length > 0
                      ? 'bg-emerald-400 ring-2 ring-emerald-400/30 anim-breathe'
                      : 'bg-sky-400 ring-2 ring-sky-400/25'
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
            <div className="my-3.5 text-start">
              <div className="flex items-baseline gap-2 flex-wrap">
                <bdi
                  dir="ltr"
                  className={`text-2xl sm:text-3xl font-bold tracking-tight leading-none tnum ${
                    availableBalance < 0 ? 'text-rose-300' : 'text-white'
                  }`}
                >
                  {formatToman(availableBalance)}
                </bdi>
                <span className="text-xs sm:text-sm font-medium text-white/65">{currency}</span>
              </div>
              {showCreditInfo && (
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px] tnum">
                  {debtAmount > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/20 border border-rose-300/35 text-rose-200">
                      <span>{t('user.wallet.debtLabel')}:</span>
                      <bdi dir="ltr" className="font-semibold">
                        {formatToman(debtAmount)}
                      </bdi>
                      <span>{currency}</span>
                    </span>
                  )}
                  {creditLimit > 0 && (
                    <>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/10 border border-white/15 text-white/85">
                        <span>{t('user.wallet.creditLimitLabel')}:</span>
                        <bdi dir="ltr" className="font-semibold">
                          {formatToman(creditLimit)}
                        </bdi>
                        <span>{currency}</span>
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-300/30 text-emerald-200">
                        <span>{t('user.wallet.purchasingPowerLabel')}:</span>
                        <bdi dir="ltr" className="font-semibold">
                          {formatToman(purchasingPower)}
                        </bdi>
                        <span>{currency}</span>
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Bottom Toolbar: Stacked Referral Code on Right, Top-up CTA on Left */}
            <div className="flex items-center justify-between gap-2.5 pt-3 border-t border-white/10">
              <div className="flex flex-col min-w-0 text-start">
                <span className="text-[11px] text-white/60 leading-tight mb-1">
                  {t('user.referral.yourCode')}
                </span>
                <div className="flex items-center gap-1.5 min-w-0">
                  <bdi
                    dir="ltr"
                    className="text-xs font-mono font-medium text-white/90 truncate"
                    title={inviteLink}
                  >
                    {formatShortRefCode(profile?.referralCode)}
                  </bdi>
                  {inviteLink && (
                    <button
                      type="button"
                      onClick={() => void handleCopyReferral()}
                      className="w-7 h-7 rounded-ctl bg-white/10 hover:bg-white/16 border border-white/10 flex items-center justify-center press rs-focus text-white/85 shrink-0 cursor-pointer"
                      title={t('user.referral.copyLink')}
                      aria-label={t('user.referral.copyLink')}
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
                className="shrink-0 ms-auto"
              >
                <Wallet className="w-3.5 h-3.5 shrink-0" />
                <span>{t('user.dashboard.quickTopup')}</span>
              </Button>
            </div>
          </div>
        </section>

        {/* Free Trial Hero CTA (auto-hides once claimed) */}
        <FreeTrialBanner
          trial={trial}
          botUsername={settings?.botUsername}
          onClaimed={onTrialClaimed}
          onNotify={notify}
        />

        {/* Lucky Wheel Shortcut Card */}
        {showWheelShortcut && luckyWheel && (
          <button
            type="button"
            onClick={() => handleAction('referral')}
            className={`group rs-card-interactive w-full rounded-card border p-4 flex items-center justify-between gap-3 text-start press rs-focus cursor-pointer shadow-[var(--shadow-card)] ${
              luckyWheel.canSpin
                ? 'border-ok/25 bg-gradient-to-l from-ok-soft via-surface to-accent-soft/35'
                : 'border-line bg-surface hover:bg-surface-2'
            }`}
          >
            <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
              <IconTile tone={luckyWheel.canSpin ? 'ok' : 'accent'} size="md">
                <Sparkles />
              </IconTile>
              <div className="flex flex-col min-w-0 gap-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-semibold text-ink">
                    {luckyWheel.canSpin
                      ? t('user.dashboard.wheelBannerReadyTitle')
                      : t('user.dashboard.wheelBannerCooldownTitle')}
                  </span>
                  {luckyWheel.canSpin && (
                    <Badge variant="success" size="xs">
                      {t('user.wheel.readyBadge')}
                    </Badge>
                  )}
                </div>
                <span className="text-xs leading-relaxed text-ink-soft">
                  {luckyWheel.canSpin
                    ? t('user.dashboard.wheelBannerReadyDesc')
                        .replace('{max}', formatToman(luckyWheel.maxPrize))
                        .replace('{currency}', currency)
                    : t('user.dashboard.wheelBannerCooldownDesc').replace(
                        '{time}',
                        formatShortCountdown(luckyWheel.secondsRemaining, locale)
                      )}
                </span>
              </div>
            </div>
            <span
              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 ${
                luckyWheel.canSpin
                  ? 'bg-ok-soft text-ok-fg border border-ok/20'
                  : 'bg-brand-soft text-brand-fg border border-brand/20'
              }`}
            >
              <span>
                {luckyWheel.canSpin
                  ? t('user.dashboard.wheelBannerCta')
                  : t('user.dashboard.wheelBannerView')}
              </span>
              <ChevronLeft className="w-3.5 h-3.5 ltr:rotate-180" aria-hidden="true" />
            </span>
          </button>
        )}

        {/* Quick Action Grid (Apple Control Center Style) */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 anim-stagger">
          <button
            type="button"
            onClick={() => handleAction('shop')}
            className="group rs-card-interactive rounded-card border border-line bg-surface hover:bg-surface-2 py-4 px-3 flex flex-col items-center justify-center gap-2.5 text-center press rs-focus cursor-pointer shadow-[var(--shadow-card)]"
          >
            <IconTile tone="brand" size="md">
              <ShoppingBag />
            </IconTile>
            <span className="text-xs font-semibold text-ink">{t('user.dashboard.buyService')}</span>
          </button>

          <button
            type="button"
            onClick={() => handleAction('services')}
            className="group rs-card-interactive rounded-card border border-line bg-surface hover:bg-surface-2 py-4 px-3 flex flex-col items-center justify-center gap-2.5 text-center press rs-focus cursor-pointer shadow-[var(--shadow-card)]"
          >
            <IconTile tone="ok" size="md">
              <Wifi />
            </IconTile>
            <span className="text-xs font-semibold text-ink">{t('user.dashboard.myConfigs')}</span>
          </button>

          <button
            type="button"
            onClick={() => handleAction('wallet')}
            className="group rs-card-interactive rounded-card border border-line bg-surface hover:bg-surface-2 py-4 px-3 flex flex-col items-center justify-center gap-2.5 text-center press rs-focus cursor-pointer shadow-[var(--shadow-card)]"
          >
            <IconTile tone="warn" size="md">
              <Wallet />
            </IconTile>
            <span className="text-xs font-semibold text-ink">{t('user.tabs.wallet')}</span>
          </button>

          <button
            type="button"
            onClick={() => handleAction('referral')}
            className="group relative rs-card-interactive rounded-card border border-line bg-surface hover:bg-surface-2 py-4 px-3 flex flex-col items-center justify-center gap-2.5 text-center press rs-focus cursor-pointer shadow-[var(--shadow-card)]"
          >
            {luckyWheel?.canSpin && (
              <span
                className="absolute top-3 end-3 w-2 h-2 rounded-full bg-ok ring-2 ring-ok/25"
                aria-hidden="true"
              />
            )}
            <IconTile tone="accent" size="md">
              <Gift />
            </IconTile>
            <span className="text-xs font-semibold text-ink">{t('user.dashboard.inviteEarn')}</span>
          </button>
        </section>

        {/* Support Card */}
        {settings?.supportEnabled !== false && Boolean(supportUrl) && (
          <button
            type="button"
            onClick={handleSupportClick}
            className="group rs-card-interactive w-full rounded-card border border-line bg-surface hover:bg-surface-2 p-3.5 flex items-center justify-between gap-3 text-start press rs-focus cursor-pointer shadow-[var(--shadow-card)]"
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
              className="w-4 h-4 shrink-0 text-ink-muted group-hover:text-brand-fg ltr:rotate-180 transition-all duration-200 group-hover:-translate-x-0.5 ltr:group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </button>
        )}
      </div>

      {/* Right column: Active/Urgent Services + Recent Activity Ledger */}
      <div className="lg:col-span-5 flex flex-col gap-5">
        <section className="w-full">
          <SectionHeader
            icon={<Activity />}
            title={
              urgentConfigs.length > 0 && activeConfigs.length === 0
                ? t('user.dashboard.servicesNeedAttention')
                : t('user.dashboard.activeServices')
            }
            count={formatNumber(activeConfigs.length)}
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
              {/* Always show urgency notice when ANY config is expired/limited/near-expiry */}
              {urgentConfigs.length > 0 && (
                <div className="rounded-tile border border-warn/35 bg-warn-soft px-3 py-2 text-xs text-warn-fg leading-relaxed flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    {t('user.dashboard.expiredServicesNotice').replace(
                      '{count}',
                      formatNumber(urgentConfigs.length)
                    )}
                  </span>
                </div>
              )}

              {displayedConfigs.map((cfg) => {
                const isAttention = isConfigUrgent(cfg, nowSec);
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
                          {cfg.userLabel ? (
                            <div className="flex flex-col min-w-0">
                              <span className="text-[13px] font-semibold truncate text-ink">
                                {cfg.userLabel}
                              </span>
                              <bdi
                                dir="ltr"
                                className="text-[11px] font-mono truncate text-ink-muted"
                              >
                                {cfg.configUsername}
                              </bdi>
                            </div>
                          ) : (
                            <bdi
                              dir="ltr"
                              className="text-[13px] font-mono font-medium truncate text-ink"
                            >
                              {cfg.configUsername}
                            </bdi>
                          )}
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
            <div className="rs-grouped-list divide-y divide-line anim-stagger">
              {transactions.slice(0, 3).map((tx) => (
                <TransactionItem key={tx.id} tx={tx} currency={currency} grouped />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
