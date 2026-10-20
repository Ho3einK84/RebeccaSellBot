import React from 'react';
import {
  Wallet,
  ShoppingBag,
  Wifi,
  Users,
  CreditCard,
  MessageCircle,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Activity,
  Copy,
  Check,
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

interface DashboardTabProps {
  profile: UserPortalProfile | null;
  settings: UserPortalSettings | null;
  configs: UserConfigRecord[];
  transactions: UserTransactionRecord[];
  onSwitchTab: (tab: UserTabType) => void;
}

export const DashboardTab: React.FC<DashboardTabProps> = ({
  profile,
  settings,
  configs,
  transactions,
  onSwitchTab,
}) => {
  const { t, isRtl } = useLanguage();
  const { triggerHaptic } = useHaptic();
  const { formatToman } = useFormatters();
  const { copy, isCopied } = useCopy();

  const currency = settings?.currency || t('common.currency');
  const availableBalance = profile?.availableBalance ?? 0;
  const activeConfigs = configs.filter((c) => c.panelStatus === 'active');

  const formatShortRefCode = (code?: string | null) => {
    if (!code) return '—';
    if (code.length <= 14) return code;
    return `${code.slice(0, 8)}...${code.slice(-4)}`;
  };

  const handleCopyReferral = () => {
    if (!profile?.referralCode) return;
    triggerHaptic('light');
    copy(profile.referralCode, 'dashboard-ref-code');
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

  const ArrowIcon = isRtl ? ChevronLeft : ChevronRight;

  return (
    <div className="w-full flex flex-col gap-4 pb-6">
      {/* Digital Wallet Card */}
      <section className="relative overflow-hidden rounded-3xl p-5 sm:p-6 text-brand-ink shadow-xl shadow-brand/20 transition-all bg-gradient-to-br from-brand via-brand to-brand border border-brand-ink/10">
        {/* Decorative background glow circles */}
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-brand-ink/10 blur-2xl pointer-events-none" />
        <div className="absolute -bottom-10 -left-10 w-36 h-36 rounded-full bg-brand/20 blur-xl pointer-events-none" />

        <div className="relative z-10 flex flex-col justify-between min-h-[140px]">
          {/* Card Top: Chip & Label */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-6 rounded-md bg-warn/80 border border-warn/40 flex items-center justify-center shadow-xs">
                <CreditCard className="w-4 h-4 text-brand-ink opacity-80" />
              </div>
              <span className="text-xs font-semibold text-brand-ink/80 tracking-wide">
                {t('user.dashboard.walletBalance')}
              </span>
            </div>

            <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-brand-ink/10 border border-brand-ink/15 text-[10px] font-medium backdrop-blur-md">
              <Sparkles className="w-3 h-3 text-warn" />
              <span>{t('user.betaBadge')}</span>
            </div>
          </div>

          {/* Card Center: Balance Amount */}
          <div className="my-3 text-start">
            <div className="flex items-baseline gap-1.5 flex-wrap">
              <span className="text-2xl sm:text-3xl font-extrabold tnum tracking-tight text-brand-ink drop-shadow-sm">
                {formatToman(availableBalance)}
              </span>
              <span className="text-xs sm:text-sm font-medium text-brand-ink/80">{currency}</span>
            </div>
          </div>

          {/* Card Bottom: Referral Code & Topup CTA */}
          <div className="flex items-center justify-between gap-3 pt-2.5 mt-2 border-t border-brand-ink/15">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="flex flex-col min-w-0 text-start">
                <span className="text-[10px] text-brand-ink/70 leading-tight mb-0.5">
                  {t('user.referral.yourCode')}
                </span>
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    dir="ltr"
                    className="text-xs tnum font-bold tracking-tight text-brand-ink/95 truncate"
                    title={profile?.referralCode || ''}
                  >
                    {formatShortRefCode(profile?.referralCode)}
                  </span>
                  {profile?.referralCode && (
                    <button
                      type="button"
                      onClick={handleCopyReferral}
                      className="p-1 rounded-lg bg-brand-ink/15 hover:bg-brand-ink/25 active:scale-90 transition-all text-brand-ink shrink-0 cursor-pointer"
                      title={t('common.copy')}
                      aria-label={t('common.copy')}
                    >
                      {isCopied('dashboard-ref-code') ? (
                        <Check className="w-3 h-3 text-ok" />
                      ) : (
                        <Copy className="w-3 h-3 text-brand-ink/90" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => handleAction('wallet')}
              className="shrink-0 px-3.5 py-1.5 rounded-xl bg-brand-ink text-brand hover:bg-brand-ink/90 font-bold text-xs flex items-center gap-1.5 transition-all active:scale-95 shadow-md cursor-pointer whitespace-nowrap"
            >
              <Wallet className="w-3.5 h-3.5 text-brand shrink-0" />
              <span>{t('user.dashboard.quickTopup')}</span>
            </button>
          </div>
        </div>
      </section>

      {/* Quick Action Grid (4 Buttons) */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <button
          type="button"
          onClick={() => handleAction('shop')}
          className={`p-3.5 rounded-2xl border flex flex-col items-center justify-center gap-2 text-center transition-all active:scale-95 cursor-pointer bg-surface/[0.03] border-line/[0.07] hover:bg-surface/[0.06] text-ink shadow-2xs`}
        >
          <div className="w-10 h-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center">
            <ShoppingBag className="w-5 h-5" />
          </div>
          <span className="text-xs font-semibold">{t('user.dashboard.buyService')}</span>
        </button>

        <button
          type="button"
          onClick={() => handleAction('services')}
          className={`p-3.5 rounded-2xl border flex flex-col items-center justify-center gap-2 text-center transition-all active:scale-95 cursor-pointer bg-surface/[0.03] border-line/[0.07] hover:bg-surface/[0.06] text-ink shadow-2xs`}
        >
          <div className="w-10 h-10 rounded-xl bg-ok/10 text-ok flex items-center justify-center">
            <Wifi className="w-5 h-5" />
          </div>
          <span className="text-xs font-semibold">{t('user.dashboard.myConfigs')}</span>
        </button>

        <button
          type="button"
          onClick={() => handleAction('wallet')}
          className={`p-3.5 rounded-2xl border flex flex-col items-center justify-center gap-2 text-center transition-all active:scale-95 cursor-pointer bg-surface/[0.03] border-line/[0.07] hover:bg-surface/[0.06] text-ink shadow-2xs`}
        >
          <div className="w-10 h-10 rounded-xl bg-warn/10 text-warn flex items-center justify-center">
            <Wallet className="w-5 h-5" />
          </div>
          <span className="text-xs font-semibold">{t('user.tabs.wallet')}</span>
        </button>

        <button
          type="button"
          onClick={() => handleAction('referral')}
          className={`p-3.5 rounded-2xl border flex flex-col items-center justify-center gap-2 text-center transition-all active:scale-95 cursor-pointer bg-surface/[0.03] border-line/[0.07] hover:bg-surface/[0.06] text-ink shadow-2xs`}
        >
          <div className="w-10 h-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center">
            <Users className="w-5 h-5" />
          </div>
          <span className="text-xs font-semibold">{t('user.dashboard.inviteEarn')}</span>
        </button>
      </section>

      {/* Active Subscriptions Overview */}
      <section className="w-full">
        <div className="flex items-center justify-between mb-2 px-1">
          <h3
            className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-ink-soft`}
          >
            <Activity className="w-3.5 h-3.5 text-brand" />
            <span>{t('user.dashboard.activeServices')}</span>
            <span className="text-[11px] tnum font-bold text-brand">({activeConfigs.length})</span>
          </h3>

          {configs.length > 0 && (
            <button
              type="button"
              onClick={() => handleAction('services')}
              className="text-xs font-medium text-brand hover:text-brand flex items-center gap-0.5 cursor-pointer"
            >
              <span>{t('common.all')}</span>
              <ArrowIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {activeConfigs.length === 0 ? (
          <div
            className={`p-4 rounded-2xl border text-center flex flex-col items-center gap-2 bg-surface/[0.02] border-line/[0.06]`}
          >
            <ShieldCheck className="w-8 h-8 text-brand/60 mt-1" />
            <span className={`text-xs font-bold text-ink-soft`}>
              {t('user.services.emptyTitle')}
            </span>
            <p className="text-[11px] text-ink-muted max-w-xs m-0">
              {t('user.services.emptyDesc')}
            </p>
            <button
              type="button"
              onClick={() => handleAction('shop')}
              className="mt-1 px-4 py-2 rounded-xl bg-brand hover:bg-brand text-brand-ink text-xs font-bold transition-all active:scale-95 cursor-pointer shadow-sm"
            >
              {t('user.services.buyFirst')}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {activeConfigs.slice(0, 2).map((cfg) => (
              <button
                type="button"
                key={cfg.id}
                onClick={() => handleAction('services')}
                className={`w-full p-3.5 rounded-2xl border transition-all cursor-pointer flex flex-col gap-2 text-start bg-surface/[0.025] border-line/[0.07] hover:border-brand/30 shadow-2xs`}
              >
                <div className="flex items-center justify-between w-full gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <ServiceStatusDot status={cfg.panelStatus} />
                    <span className={`text-xs tnum font-bold truncate text-ink`}>
                      {cfg.configUsername}
                    </span>
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
            ))}
          </div>
        )}
      </section>

      {/* Support Card */}
      {settings?.supportEnabled !== false && Boolean(settings?.supportUsername) && (
        <button
          type="button"
          onClick={handleSupportClick}
          className={`w-full p-3.5 rounded-2xl border flex items-center justify-between gap-3 text-start transition-all cursor-pointer bg-brand/20 border-brand/20 hover:bg-brand/30`}
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-brand/15 text-brand flex items-center justify-center shrink-0">
              <MessageCircle className="w-4 h-4" />
            </div>
            <div className="flex flex-col">
              <span className="text-[12.5px] font-bold text-ink">
                {t('user.dashboard.supportHelp')}
              </span>
              <span className="mt-0.5 text-[11px] leading-snug text-ink-muted">
                {t('user.dashboard.supportSub')}
              </span>
            </div>
          </div>
          <ChevronLeft className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
        </button>
      )}

      {/* Recent Transactions Preview */}
      <section className="w-full">
        <div className="flex items-center justify-between mb-2 px-1">
          <h3 className={`text-xs font-bold uppercase tracking-wider text-ink-muted`}>
            {t('user.dashboard.recentActivity')}
          </h3>
          {transactions.length > 0 && (
            <button
              type="button"
              onClick={() => handleAction('wallet')}
              className="text-xs font-medium text-brand hover:text-brand cursor-pointer"
            >
              {t('common.all')}
            </button>
          )}
        </div>

        {transactions.length === 0 ? (
          <div
            className={`p-3.5 rounded-2xl border text-center text-[11px] bg-surface/[0.02] border-line/[0.06] text-ink-muted`}
          >
            {t('user.dashboard.noRecentActivity')}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {transactions.slice(0, 3).map((tx) => {
              const isCredit = tx.amount > 0;
              return (
                <div
                  key={tx.id}
                  className={`p-3 rounded-xl border flex items-center justify-between text-start bg-surface/[0.02] border-line/[0.06]`}
                >
                  <div className="flex flex-col min-w-0 pr-2">
                    <span className={`text-xs font-semibold truncate text-ink-soft`}>
                      {tx.description}
                    </span>
                    <span className="text-[10px] text-ink-muted">
                      {new Date(tx.createdAt).toLocaleDateString(isRtl ? 'fa-IR' : 'en-US')}
                    </span>
                  </div>
                  <span
                    dir="ltr"
                    className={`tnum font-bold text-xs shrink-0 ${
                      isCredit ? 'text-ok' : 'text-danger'
                    }`}
                  >
                    {isCredit ? '+' : ''}
                    {formatToman(tx.amount)} {currency}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
