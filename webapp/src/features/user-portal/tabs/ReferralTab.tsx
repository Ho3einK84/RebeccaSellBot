import React from 'react';
import { Users, Gift, Copy, Check, Share2, Award } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import type { UserPortalProfile, UserPortalSettings } from '@/shared/types/userPortal.js';

interface ReferralTabProps {
  profile: UserPortalProfile | null;
  settings: UserPortalSettings | null;
  onNotify: (message: string) => void;
}

export const ReferralTab: React.FC<ReferralTabProps> = ({ profile, settings, onNotify }) => {
  const { t } = useLanguage();
  const { formatToman, formatNumber } = useFormatters();
  const { copy, isCopied } = useCopy();
  const { triggerHaptic } = useHaptic();

  const currency = settings?.currency || t('common.currency');
  const referralCode = profile?.referralCode || '';
  const botUsername = settings?.botUsername || '';
  const inviteLink =
    referralCode && botUsername
      ? `https://t.me/${botUsername}?start=${referralCode}`
      : referralCode
        ? `https://t.me?start=${referralCode}`
        : '';

  const handleCopyLink = () => {
    if (!inviteLink) return;
    triggerHaptic('light');
    copy(inviteLink, 'referral-link');
    onNotify(t('user.referral.linkCopied'));
  };

  const handleCopyCode = () => {
    if (!referralCode) return;
    triggerHaptic('light');
    copy(referralCode, 'referral-code');
    onNotify(t('user.referral.linkCopied'));
  };

  const handleShareTelegram = () => {
    triggerHaptic('medium');
    if (!inviteLink) return;
    const shareText = encodeURIComponent(t('user.referral.shareMessage'));
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${shareText}`;

    if (window.Telegram?.WebApp?.openTelegramLink) {
      window.Telegram.WebApp.openTelegramLink(shareUrl);
    } else {
      window.open(shareUrl, '_blank');
    }
  };

  return (
    <div className="w-full flex flex-col gap-4 pb-6 text-start">
      {/* Referral Hero Banner */}
      <section
        className={`p-5 rounded-3xl border relative overflow-hidden flex flex-col gap-3 transition-all bg-gradient-to-br from-brand-soft via-surface to-brand-soft/50 dark:from-brand/35 dark:via-surface dark:to-brand/20 border-brand/20 shadow-lg shadow-brand/10 shadow-2xs`}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-brand/15 text-brand flex items-center justify-center shrink-0 border border-brand/25">
            <Gift className="w-5 h-5" />
          </div>
          <div className="flex flex-col">
            <h2 className={`text-sm sm:text-base font-bold text-ink`}>
              {t('user.referral.title')}
            </h2>
            <span className="text-[11px] text-ink-muted">{t('user.referral.ruleDesc')}</span>
          </div>
        </div>
      </section>

      {/* Referral Stats Cards */}
      <section className="grid grid-cols-2 gap-3">
        <div
          className={`p-4 rounded-2xl border flex flex-col gap-1 text-center justify-center bg-surface border-line shadow-2xs`}
        >
          <div className="w-8 h-8 rounded-xl bg-brand/10 text-brand flex items-center justify-center mx-auto mb-1 border border-brand/15">
            <Users className="w-4 h-4" />
          </div>
          <span className="text-[11px] text-ink-muted">{t('user.referral.statsInvited')}</span>
          <span className={`tnum text-lg sm:text-xl font-extrabold text-ink`}>
            {formatNumber(profile?.referredUserCount ?? 0)}
          </span>
        </div>

        <div
          className={`p-4 rounded-2xl border flex flex-col gap-1 text-center justify-center bg-surface border-line shadow-2xs`}
        >
          <div className="w-8 h-8 rounded-xl bg-ok/10 text-ok flex items-center justify-center mx-auto mb-1 border border-ok/15">
            <Award className="w-4 h-4" />
          </div>
          <span className="text-[11px] text-ink-muted">{t('user.referral.statsEarned')}</span>
          <div
            className={`flex items-center justify-center gap-1.5 tnum text-lg sm:text-xl font-extrabold text-ok`}
          >
            <span>{formatToman(profile?.referralBonusEarned ?? 0)}</span>
            <span className="text-xs font-sans font-medium opacity-80">{currency}</span>
          </div>
        </div>
      </section>

      {/* Referral Code & Link Box */}
      <section
        className={`p-4 sm:p-5 rounded-3xl border flex flex-col gap-3.5 bg-surface border-line shadow-2xs`}
      >
        {/* Referral Code Box */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-bold text-ink-soft">{t('user.referral.yourCode')}</span>
          <button
            type="button"
            onClick={handleCopyCode}
            className={`w-full p-2.5 rounded-xl border flex items-center justify-between gap-2.5 transition-all active:scale-[0.99] cursor-pointer text-start bg-surface-2 border-line hover:border-line-strong`}
          >
            <span
              dir="ltr"
              className="font-mono font-bold text-xs sm:text-sm text-brand truncate flex-1 min-w-0 select-all"
            >
              {referralCode || '—'}
            </span>
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium shrink-0 transition-colors ${isCopied('referral-code') ? 'bg-ok/15 text-ok border border-ok/25' : 'bg-surface-3 text-ink-soft border border-line shadow-2xs'}`}
            >
              {isCopied('referral-code') ? (
                <>
                  <Check className="w-3.5 h-3.5 text-ok" />
                  <span>{t('common.copied')}</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>{t('common.copy')}</span>
                </>
              )}
            </span>
          </button>
        </div>

        {/* Link Box */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-bold text-ink-soft">{t('user.referral.yourLink')}</span>
          <button
            type="button"
            onClick={handleCopyLink}
            className={`w-full p-2.5 rounded-xl border flex items-center justify-between gap-2.5 transition-all active:scale-[0.99] cursor-pointer text-start bg-surface-2 border-line hover:border-line-strong`}
          >
            <span
              dir="ltr"
              className="font-mono text-xs truncate flex-1 min-w-0 text-ink-soft select-all"
            >
              {inviteLink || '—'}
            </span>
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium shrink-0 transition-colors ${isCopied('referral-link') ? 'bg-ok/15 text-ok border border-ok/25' : 'bg-surface-3 text-ink-soft border border-line shadow-2xs'}`}
            >
              {isCopied('referral-link') ? (
                <>
                  <Check className="w-3.5 h-3.5 text-ok" />
                  <span>{t('common.copied')}</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>{t('common.copy')}</span>
                </>
              )}
            </span>
          </button>
        </div>

        {/* Action Buttons: Copy Link & Share */}
        <div className="grid grid-cols-2 gap-2 mt-1">
          <button
            type="button"
            onClick={handleCopyLink}
            className={`py-2.5 px-3 rounded-xl font-medium text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer ${isCopied('referral-link') ? 'bg-ok text-white font-bold' : 'bg-surface-2 hover:bg-surface-3 text-ink-soft border border-line'}`}
          >
            {isCopied('referral-link') ? (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>{t('user.referral.linkCopied')}</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>{t('user.referral.copyLink')}</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleShareTelegram}
            className="py-2.5 px-3 rounded-xl bg-brand hover:bg-brand text-brand-ink font-bold text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-md"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>{t('user.referral.shareTelegram')}</span>
          </button>
        </div>
      </section>
    </div>
  );
};
