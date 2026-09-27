import React from 'react';
import { Users, Gift, Copy, Check, Share2, Award } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
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
  const { isDark } = useThemeTokens();
  const { formatToman } = useFormatters();
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
        className={`p-5 rounded-3xl border relative overflow-hidden flex flex-col gap-3 transition-all ${
          isDark
            ? 'bg-gradient-to-br from-purple-950/40 via-indigo-950/20 to-zinc-900/60 border-purple-500/20 shadow-lg shadow-purple-950/20'
            : 'bg-gradient-to-br from-purple-50/80 via-white to-indigo-50/70 border-purple-200/90 shadow-2xs'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-purple-500/15 text-purple-500 flex items-center justify-center shrink-0">
            <Gift className="w-5 h-5" />
          </div>
          <div className="flex flex-col">
            <h2
              className={`text-sm sm:text-base font-bold ${
                isDark ? 'text-white' : 'text-slate-900'
              }`}
            >
              {t('user.referral.title')}
            </h2>
            <span className="text-[11px] text-slate-500 dark:text-zinc-400">
              {t('user.referral.ruleDesc')}
            </span>
          </div>
        </div>
      </section>

      {/* Referral Stats Cards */}
      <section className="grid grid-cols-2 gap-3">
        <div
          className={`p-4 rounded-2xl border flex flex-col gap-1 text-center justify-center ${
            isDark
              ? 'bg-white/[0.025] border-white/[0.07]'
              : 'bg-white border-slate-200/80 shadow-2xs'
          }`}
        >
          <div className="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center mx-auto mb-1">
            <Users className="w-4 h-4" />
          </div>
          <span className="text-[11px] text-slate-500 dark:text-zinc-400">
            {t('user.referral.statsInvited')}
          </span>
          <span
            className={`font-mono text-lg sm:text-xl font-extrabold ${
              isDark ? 'text-white' : 'text-slate-900'
            }`}
          >
            {profile?.referredUserCount ?? 0}
          </span>
        </div>

        <div
          className={`p-4 rounded-2xl border flex flex-col gap-1 text-center justify-center ${
            isDark
              ? 'bg-white/[0.025] border-white/[0.07]'
              : 'bg-white border-slate-200/80 shadow-2xs'
          }`}
        >
          <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center mx-auto mb-1">
            <Award className="w-4 h-4" />
          </div>
          <span className="text-[11px] text-slate-500 dark:text-zinc-400">
            {t('user.referral.statsEarned')}
          </span>
          <span
            dir="ltr"
            className={`font-mono text-lg sm:text-xl font-extrabold ${
              isDark ? 'text-emerald-400' : 'text-emerald-600'
            }`}
          >
            {formatToman(profile?.referralBonusEarned ?? 0)} {currency}
          </span>
        </div>
      </section>

      {/* Referral Code & Link Box */}
      <section
        className={`p-4 sm:p-5 rounded-3xl border flex flex-col gap-3.5 ${
          isDark
            ? 'bg-white/[0.025] border-white/[0.08]'
            : 'bg-white border-slate-200/90 shadow-2xs'
        }`}
      >
        <div className="flex flex-col gap-1">
          <span className="text-xs font-bold text-slate-700 dark:text-zinc-300">
            {t('user.referral.yourCode')}
          </span>
          <div
            onClick={handleCopyCode}
            className={`p-2.5 rounded-xl border flex items-center justify-between cursor-pointer transition-all active:scale-[0.99] ${
              isDark ? 'bg-zinc-900 border-white/10' : 'bg-slate-50 border-slate-200'
            }`}
          >
            <span dir="ltr" className="font-mono font-bold text-sm tracking-widest text-indigo-400">
              {referralCode || '—'}
            </span>
            <span className="text-[11px] text-slate-400 flex items-center gap-1">
              {isCopied('referral-code') ? (
                <Check className="w-3.5 h-3.5 text-emerald-500" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </span>
          </div>
        </div>

        {/* Link Box */}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-bold text-slate-700 dark:text-zinc-300">
            {t('user.referral.yourLink')}
          </span>
          <div
            onClick={handleCopyLink}
            className={`p-2.5 rounded-xl border flex items-center justify-between cursor-pointer transition-all active:scale-[0.99] ${
              isDark ? 'bg-zinc-900 border-white/10' : 'bg-slate-50 border-slate-200'
            }`}
          >
            <span
              dir="ltr"
              className="font-mono text-xs truncate max-w-[240px] sm:max-w-xs text-slate-600 dark:text-zinc-400"
            >
              {inviteLink || '—'}
            </span>
            <span className="text-[11px] text-slate-400 flex items-center gap-1 shrink-0">
              {isCopied('referral-link') ? (
                <Check className="w-3.5 h-3.5 text-emerald-500" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </span>
          </div>
        </div>

        {/* Action Buttons: Copy Link & Share */}
        <div className="grid grid-cols-2 gap-2 mt-1">
          <button
            type="button"
            onClick={handleCopyLink}
            className={`py-2.5 px-3 rounded-xl font-medium text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer ${
              isCopied('referral-link')
                ? 'bg-emerald-600 text-white'
                : isDark
                  ? 'bg-white/10 hover:bg-white/15 text-white border border-white/10'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200'
            }`}
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
            className="py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-md"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>{t('user.referral.shareTelegram')}</span>
          </button>
        </div>
      </section>
    </div>
  );
};
