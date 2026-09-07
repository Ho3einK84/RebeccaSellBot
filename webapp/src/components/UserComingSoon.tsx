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
  ChevronRight,
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

  const features = [
    {
      icon: Zap,
      titleKey: 'featurePurchaseTitle' as const,
      descKey: 'featurePurchaseDesc' as const,
      color: 'indigo' as const,
    },
    {
      icon: Activity,
      titleKey: 'featureTrafficTitle' as const,
      descKey: 'featureTrafficDesc' as const,
      color: 'emerald' as const,
    },
    {
      icon: QrCode,
      titleKey: 'featureConfigsTitle' as const,
      descKey: 'featureConfigsDesc' as const,
      color: 'violet' as const,
    },
    {
      icon: Wallet,
      titleKey: 'featureWalletTitle' as const,
      descKey: 'featureWalletDesc' as const,
      color: 'amber' as const,
    },
  ];

  const colorMap = {
    indigo: {
      iconBg: 'bg-indigo-500/10',
      iconBorder: 'border-indigo-500/20',
      iconText: 'text-indigo-400',
      hoverBorder: 'hover:border-indigo-500/40',
      dot: 'bg-indigo-400',
    },
    emerald: {
      iconBg: 'bg-emerald-500/10',
      iconBorder: 'border-emerald-500/20',
      iconText: 'text-emerald-400',
      hoverBorder: 'hover:border-emerald-500/40',
      dot: 'bg-emerald-400',
    },
    violet: {
      iconBg: 'bg-violet-500/10',
      iconBorder: 'border-violet-500/20',
      iconText: 'text-violet-400',
      hoverBorder: 'hover:border-violet-500/40',
      dot: 'bg-violet-400',
    },
    amber: {
      iconBg: 'bg-amber-500/10',
      iconBorder: 'border-amber-500/20',
      iconText: 'text-amber-400',
      hoverBorder: 'hover:border-amber-500/40',
      dot: 'bg-amber-400',
    },
  } as const;

  return (
    <div className="cs-page min-h-screen min-h-[100dvh] w-full flex flex-col items-center justify-start p-0 bg-[#060911] relative overflow-x-hidden overflow-y-auto safe-top text-slate-100">
      {/* Ambient background orbs */}
      <div className="cs-orb cs-orb-1" />
      <div className="cs-orb cs-orb-2" />
      <div className="cs-orb cs-orb-3" />

      {/* Subtle grid overlay */}
      <div className="absolute inset-0 cs-grid-overlay pointer-events-none" />

      {/* Top bar */}
      <div className="w-full max-w-lg mx-auto flex items-center justify-between px-5 pt-4 pb-2 relative z-10">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/8 border border-emerald-500/15 text-[11px] font-medium text-emerald-400/90">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 status-pulse" />
          <span>{t('serviceOnlineStatus')}</span>
        </div>

        {languageSelectionEnabled && (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-white/8 hover:border-white/15 hover:bg-white/5 text-slate-400 text-[11px] font-medium transition-all active:scale-95"
            onClick={handleToggleLanguage}
          >
            <Globe className="w-3 h-3 text-slate-500" />
            <span>{t('switchLang')}</span>
          </button>
        )}
      </div>

      {/* Content container */}
      <div className="w-full max-w-lg mx-auto flex flex-col items-center px-5 pb-8 relative z-10 flex-1">
        {/* Hero section */}
        <div className="flex flex-col items-center pt-6 sm:pt-10 pb-6">
          {/* Avatar with gradient ring */}
          <div className="relative mb-5 cs-avatar-entrance">
            <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-indigo-500/40 via-violet-500/40 to-pink-500/40 blur-xl cs-breathe" />
            <div className="relative w-[72px] h-[72px] sm:w-20 sm:h-20 rounded-full p-[2px] bg-gradient-to-tr from-indigo-500 via-violet-500 to-pink-500">
              <div className="w-full h-full rounded-full overflow-hidden bg-[#0c1021] flex items-center justify-center">
                {user.photo_url ? (
                  <img
                    src={user.photo_url}
                    alt={displayName}
                    className="w-full h-full object-cover"
                  />
                ) : initials ? (
                  <span className="text-lg sm:text-xl font-bold font-mono tracking-wider text-white/90">
                    {initials}
                  </span>
                ) : (
                  <User className="w-7 h-7 text-slate-400" />
                )}
              </div>
            </div>

            {user.is_premium && (
              <div
                className="absolute -bottom-0.5 -end-0.5 w-5.5 h-5.5 rounded-full bg-gradient-to-tr from-amber-400 to-amber-500 border-2 border-[#060911] flex items-center justify-center shadow-lg shadow-amber-500/20"
                title={t('premiumUserBadge')}
              >
                <Star className="w-3 h-3 text-slate-950 fill-slate-950" />
              </div>
            )}
          </div>

          {/* Greeting */}
          <h1 className="text-[22px] sm:text-2xl font-bold text-white mb-1.5 tracking-tight flex items-center justify-center gap-2 flex-wrap cs-fade-in">
            <span>{locale === 'fa' ? 'سلام،' : 'Hello,'}</span>
            <span className="bg-gradient-to-r from-white via-indigo-200 to-violet-200 bg-clip-text text-transparent">
              {displayName}
            </span>
            <span className="animate-wave select-none text-lg">👋</span>
          </h1>

          {/* Identity chips */}
          <div className="flex flex-wrap items-center justify-center gap-1.5 cs-fade-in-delay-1">
            <button
              type="button"
              onClick={handleCopyId}
              className="inline-flex items-center gap-1.5 bg-white/[0.04] hover:bg-white/[0.07] active:scale-[0.97] border border-white/[0.06] hover:border-white/[0.12] px-2.5 py-1 rounded-full text-[11px] transition-all cursor-pointer group"
              title={t('copy')}
            >
              <span className="text-slate-500">{t('telegramId')}</span>
              <code
                dir="ltr"
                className="font-mono font-semibold text-slate-300 tracking-wide text-[11px]"
              >
                {user.id}
              </code>
              {copied ? (
                <Check className="w-3 h-3 text-emerald-400" />
              ) : (
                <Copy className="w-3 h-3 text-slate-500 group-hover:text-slate-300 transition-colors" />
              )}
            </button>

            {user.username && (
              <div
                dir="ltr"
                className="inline-flex items-center gap-0.5 bg-white/[0.04] border border-white/[0.06] px-2.5 py-1 rounded-full text-[11px] text-slate-400 font-mono"
              >
                <span className="text-indigo-400/70">@</span>
                <span>{user.username}</span>
              </div>
            )}

            {user.is_premium && (
              <div className="inline-flex items-center gap-1 bg-amber-500/8 border border-amber-500/15 px-2 py-1 rounded-full text-[10px] text-amber-400/80 font-medium">
                <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />
                <span>{t('premiumUserBadge')}</span>
              </div>
            )}
          </div>
        </div>

        {/* Coming Soon announcement card */}
        <div className="w-full rounded-2xl p-5 sm:p-6 mb-5 relative overflow-hidden border border-white/[0.06] bg-white/[0.02] backdrop-blur-sm cs-fade-in-delay-2">
          {/* Accent line at top */}
          <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent" />

          <div className="flex items-center gap-2 mb-3">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 uppercase tracking-wider">
              <Sparkles className="w-3 h-3 text-indigo-400" />
              <span>{t('userPortalBadge')}</span>
            </div>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/8 border border-amber-500/15 text-amber-400/80">
              <span className="w-1 h-1 rounded-full bg-amber-400 animate-pulse" />
              <span>{t('inDevelopmentStatus')}</span>
            </span>
          </div>

          <h2 className="text-base sm:text-lg font-bold text-white mb-2 leading-snug">
            {t('portalTitle')}
          </h2>

          <p className="text-xs sm:text-[13px] text-slate-400 leading-relaxed m-0">
            {t('portalDesc')}
          </p>
        </div>

        {/* Features list */}
        <div className="w-full mb-5 cs-fade-in-delay-3">
          <div className="flex items-center gap-2 mb-3 px-0.5">
            <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">
              {t('upcomingFeaturesTitle')}
            </h3>
          </div>

          <div className="flex flex-col gap-2">
            {features.map((feat, i) => {
              const colors = colorMap[feat.color];
              const Icon = feat.icon;
              return (
                <div
                  key={i}
                  className={`rounded-xl p-3 bg-white/[0.02] border border-white/[0.05] ${colors.hoverBorder} transition-all flex items-center gap-3 group`}
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <div
                    className={`w-9 h-9 rounded-xl ${colors.iconBg} border ${colors.iconBorder} flex items-center justify-center shrink-0 ${colors.iconText} transition-transform group-hover:scale-105`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-[13px] font-semibold text-slate-200 mb-0.5 leading-tight">
                      {t(feat.titleKey)}
                    </h4>
                    <p className="text-[11px] text-slate-500 leading-snug m-0">{t(feat.descKey)}</p>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-600 shrink-0 rtl:rotate-180" />
                </div>
              );
            })}
          </div>
        </div>

        {/* Bot active notice */}
        <div className="w-full rounded-xl p-3.5 mb-6 bg-emerald-500/[0.04] border border-emerald-500/10 flex items-start gap-3 text-start cs-fade-in-delay-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/15 flex items-center justify-center shrink-0 text-emerald-400 mt-0.5">
            <Bot className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-xs font-semibold text-emerald-300/90 mb-0.5">
              {t('currentServicesReadyTitle')}
            </h4>
            <p className="text-[11px] text-slate-400 leading-relaxed m-0">
              {t('currentServicesReadyDesc')}
            </p>
          </div>
        </div>

        {/* Spacer for mobile */}
        <div className="flex-1 min-h-2" />

        {/* CTA */}
        <div className="w-full flex flex-col items-center gap-2 pb-4 cs-fade-in-delay-3">
          <button
            type="button"
            className="btn w-full h-12 text-sm font-semibold bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-xl shadow-lg shadow-indigo-600/20 border-none flex items-center justify-center gap-2 active:scale-[0.98] transition-all cursor-pointer"
            onClick={handleClose}
          >
            <Send className="w-4 h-4 rtl:rotate-180" />
            <span>{t('backToBot')}</span>
          </button>
          <span className="text-[10px] text-slate-600 select-none">{t('closeMiniAppHint')}</span>
        </div>
      </div>
    </div>
  );
};
