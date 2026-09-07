import React, { useState } from 'react';
import type { TelegramWebAppUser } from '../types/telegram.js';
import { useLanguage } from '../i18n/LanguageContext.js';
import {
  User,
  Globe,
  Sparkles,
  Send,
  Bot,
  Zap,
  Activity,
  QrCode,
  Wallet,
  Copy,
  Check,
  Star,
  Layers,
} from 'lucide-react';

interface UserComingSoonProps {
  user: TelegramWebAppUser;
}

export const UserComingSoon: React.FC<UserComingSoonProps> = ({ user }) => {
  const { t, locale, languageSelectionEnabled, setLocale } = useLanguage();
  const [copied, setCopied] = useState(false);

  const handleClose = () => {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('medium');
    if (window.Telegram?.WebApp?.close) {
      window.Telegram.WebApp.close();
    } else {
      window.close();
    }
  };

  const handleToggleLanguage = () => {
    window.Telegram?.WebApp?.HapticFeedback?.selectionChanged();
    void setLocale(locale === 'fa' ? 'en' : 'fa');
  };

  const handleCopyId = () => {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');
    const idStr = String(user.id);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(idStr)
        .then(() => {
          window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        })
        .catch(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
    } else {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Sanitize display name so that lone punctuation like "." or "-" falls back cleanly to guestUser
  const rawName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  const isMeaningfulName = rawName.replace(/[\s.,_\-!?:;~*#@^&()[\]{}|/\\]/g, '').length > 0;
  const displayName = isMeaningfulName ? rawName : t('guestUser');

  const initials = isMeaningfulName
    ? ((user.first_name?.trim()?.[0] || '') + (user.last_name?.trim()?.[0] || '')).toUpperCase()
    : '';

  return (
    <div className="min-h-screen min-h-[100dvh] w-full flex flex-col items-center justify-start sm:justify-center p-3 sm:p-6 bg-[#070a13] relative overflow-x-hidden safe-top mobile-safe-bottom text-slate-100">
      {/* Radiant ambient glow lights */}
      <div className="absolute -top-24 -left-20 w-80 h-80 bg-indigo-600/20 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute top-1/3 -right-20 w-80 h-80 bg-violet-600/20 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute -bottom-20 left-1/4 w-80 h-80 bg-cyan-600/10 rounded-full blur-[100px] pointer-events-none" />

      {/* Main glass panel */}
      <div className="glass-panel p-5 sm:p-7 max-w-xl w-full text-center flex flex-col items-center relative z-10 border border-white/10 shadow-2xl backdrop-blur-2xl my-auto">
        {/* Top utility row */}
        <div className="w-full flex items-center justify-between gap-2 mb-5 pb-3 border-b border-white/5">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-medium text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400 status-pulse" />
            <span>{t('serviceOnlineStatus')}</span>
          </div>

          {languageSelectionEnabled && (
            <button
              type="button"
              className="btn btn-ghost btn-xs h-7 px-2.5 rounded-full gap-1.5 border border-white/10 hover:bg-white/10 text-slate-300 text-[11px] font-medium transition-all"
              onClick={handleToggleLanguage}
            >
              <Globe className="w-3.5 h-3.5 text-indigo-400" />
              <span>{t('switchLang')}</span>
            </button>
          )}
        </div>

        {/* User Identity Section */}
        <div className="relative mb-3 group">
          <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 blur-md opacity-50" />
          <div className="relative w-20 h-20 sm:w-22 sm:h-22 rounded-full p-[3px] bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 shadow-xl shadow-indigo-500/25">
            <div className="w-full h-full rounded-full overflow-hidden bg-slate-900 flex items-center justify-center border-2 border-[#070a13]">
              {user.photo_url ? (
                <img
                  src={user.photo_url}
                  alt={displayName}
                  className="w-full h-full object-cover"
                />
              ) : initials ? (
                <span className="text-xl sm:text-2xl font-black font-mono tracking-wider bg-gradient-to-br from-white to-slate-300 bg-clip-text text-transparent">
                  {initials}
                </span>
              ) : (
                <User className="w-9 h-9 text-indigo-300/80" />
              )}
            </div>
          </div>

          {user.is_premium ? (
            <div
              className="absolute -bottom-1 -end-1 w-6 h-6 rounded-full bg-gradient-to-tr from-amber-400 to-amber-600 border-2 border-[#070a13] flex items-center justify-center shadow-lg shadow-amber-500/30"
              title={t('premiumUserBadge')}
            >
              <Star className="w-3.5 h-3.5 text-slate-950 fill-slate-950" />
            </div>
          ) : (
            <div
              className="absolute -bottom-1 -end-1 w-5 h-5 rounded-full bg-emerald-500 border-2 border-[#070a13] flex items-center justify-center shadow-md"
              title={t('serviceOnlineStatus')}
            >
              <Check className="w-3 h-3 text-white stroke-[3]" />
            </div>
          )}
        </div>

        {/* Greeting with animated wave */}
        <h1 className="text-xl sm:text-2xl font-black text-white mb-2 tracking-tight flex items-center justify-center gap-2 flex-wrap">
          <span>{locale === 'fa' ? 'سلام،' : 'Hello,'}</span>
          <span className="bg-gradient-to-r from-indigo-200 via-purple-200 to-pink-200 bg-clip-text text-transparent">
            {displayName}
          </span>
          <span className="animate-wave select-none text-xl">👋</span>
        </h1>

        {/* Identity chips */}
        <div className="flex flex-wrap items-center justify-center gap-2 mb-5">
          <button
            type="button"
            onClick={handleCopyId}
            className="inline-flex items-center gap-1.5 bg-slate-900/90 hover:bg-slate-850 active:scale-95 border border-white/10 hover:border-indigo-400/50 px-3 py-1.5 rounded-full text-xs transition-all shadow-inner cursor-pointer group"
            title={t('copy')}
          >
            <span className="text-slate-400 select-none">{t('telegramId')}</span>
            <code dir="ltr" className="font-mono font-bold text-indigo-300 tracking-wider">
              {user.id}
            </code>
            {copied ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400">
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>{t('copiedId')}</span>
              </span>
            ) : (
              <Copy className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-300 transition-colors" />
            )}
          </button>

          {user.username && (
            <div
              dir="ltr"
              className="inline-flex items-center gap-1 bg-white/5 border border-white/10 px-2.5 py-1.5 rounded-full text-xs text-slate-300 font-mono"
            >
              <span className="text-indigo-400 font-semibold select-none">@</span>
              <span>{user.username}</span>
            </div>
          )}

          {user.is_premium && (
            <div className="inline-flex items-center gap-1 bg-amber-500/10 border border-amber-500/25 px-2.5 py-1.5 rounded-full text-xs text-amber-300 font-medium">
              <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
              <span>{t('premiumUserBadge')}</span>
            </div>
          )}
        </div>

        {/* Coming Soon Hero Teaser */}
        <div className="w-full relative rounded-3xl p-5 sm:p-6 mb-5 overflow-hidden border border-indigo-500/30 bg-gradient-to-b from-indigo-950/40 via-slate-900/80 to-slate-900/95 backdrop-blur-xl shadow-xl text-center">
          <div className="absolute -top-10 -right-10 w-32 h-32 bg-indigo-500/20 rounded-full blur-2xl pointer-events-none" />
          <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-purple-500/20 rounded-full blur-2xl pointer-events-none" />

          <div className="flex items-center justify-center gap-2 mb-3">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/15 border border-indigo-500/30 text-indigo-300">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>{t('userPortalBadge')}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-500/15 border border-amber-500/30 text-amber-300">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span>{t('inDevelopmentStatus')}</span>
            </span>
          </div>

          <h2 className="text-base sm:text-lg font-bold text-white mb-2 leading-snug">
            {t('portalTitle')}
          </h2>

          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed max-w-md mx-auto m-0">
            {t('portalDesc')}
          </p>
        </div>

        {/* Upcoming Features Roadmap */}
        <div className="w-full mb-5 text-start">
          <div className="flex items-center gap-2 mb-2.5 px-1">
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
              {t('upcomingFeaturesTitle')}
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {/* Feature 1: Purchase */}
            <div className="rounded-2xl p-3 bg-slate-900/60 hover:bg-slate-900/90 border border-white/5 hover:border-indigo-500/30 transition-all flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center shrink-0 text-indigo-400 mt-0.5">
                <Zap className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h4 className="text-xs font-bold text-slate-200 mb-0.5">
                  {t('featurePurchaseTitle')}
                </h4>
                <p className="text-[11px] text-slate-400 leading-snug m-0">
                  {t('featurePurchaseDesc')}
                </p>
              </div>
            </div>

            {/* Feature 2: Traffic */}
            <div className="rounded-2xl p-3 bg-slate-900/60 hover:bg-slate-900/90 border border-white/5 hover:border-emerald-500/30 transition-all flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center shrink-0 text-emerald-400 mt-0.5">
                <Activity className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h4 className="text-xs font-bold text-slate-200 mb-0.5">
                  {t('featureTrafficTitle')}
                </h4>
                <p className="text-[11px] text-slate-400 leading-snug m-0">
                  {t('featureTrafficDesc')}
                </p>
              </div>
            </div>

            {/* Feature 3: Configs & QR */}
            <div className="rounded-2xl p-3 bg-slate-900/60 hover:bg-slate-900/90 border border-white/5 hover:border-violet-500/30 transition-all flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center shrink-0 text-violet-400 mt-0.5">
                <QrCode className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h4 className="text-xs font-bold text-slate-200 mb-0.5">
                  {t('featureConfigsTitle')}
                </h4>
                <p className="text-[11px] text-slate-400 leading-snug m-0">
                  {t('featureConfigsDesc')}
                </p>
              </div>
            </div>

            {/* Feature 4: Wallet & Referral */}
            <div className="rounded-2xl p-3 bg-slate-900/60 hover:bg-slate-900/90 border border-white/5 hover:border-amber-500/30 transition-all flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center shrink-0 text-amber-400 mt-0.5">
                <Wallet className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h4 className="text-xs font-bold text-slate-200 mb-0.5">
                  {t('featureWalletTitle')}
                </h4>
                <p className="text-[11px] text-slate-400 leading-snug m-0">
                  {t('featureWalletDesc')}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Current Active Bot Notice */}
        <div className="w-full rounded-2xl p-3.5 mb-5 bg-emerald-950/20 border border-emerald-500/20 flex items-start gap-3 text-start">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0 text-emerald-400 mt-0.5">
            <Bot className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              <h4 className="text-xs font-bold text-emerald-300">
                {t('currentServicesReadyTitle')}
              </h4>
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed m-0">
              {t('currentServicesReadyDesc')}
            </p>
          </div>
        </div>

        {/* Primary CTA */}
        <div className="w-full flex flex-col items-center gap-2">
          <button
            type="button"
            className="btn w-full h-12 text-sm sm:text-base font-bold bg-gradient-to-r from-indigo-500 via-indigo-600 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white rounded-2xl shadow-xl shadow-indigo-600/30 border-none flex items-center justify-center gap-2 active:scale-[0.98] transition-all cursor-pointer"
            onClick={handleClose}
          >
            <Send className="w-4 h-4 rtl:rotate-180" />
            <span>{t('backToBot')}</span>
          </button>
          <span className="text-[11px] text-slate-500 select-none">{t('closeMiniAppHint')}</span>
        </div>
      </div>
    </div>
  );
};
