import React, { useState, useEffect } from 'react';
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

  // Connect native Telegram WebApp BackButton
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg?.BackButton) {
      tg.BackButton.show();
      const onBackClick = () => {
        handleClose();
      };
      tg.BackButton.onClick(onBackClick);
      return () => {
        tg.BackButton?.offClick(onBackClick);
        tg.BackButton?.hide();
      };
    }
  }, []);

  const handleToggleLanguage = () => {
    window.Telegram?.WebApp?.HapticFeedback?.selectionChanged();
    void setLocale(locale === 'fa' ? 'en' : 'fa');
  };

  const copyToClipboard = (text: string) => {
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text).catch(() => {
        legacyCopy(text);
      });
    }
    legacyCopy(text);
    return Promise.resolve();
  };

  const legacyCopy = (text: string) => {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    } catch {
      // ignore
    }
  };

  const handleCopyId = () => {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');
    const idStr = String(user.id);
    void copyToClipboard(idStr).then(() => {
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
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
      hoverBorder: 'hover:border-indigo-500/30',
    },
    emerald: {
      iconBg: 'bg-emerald-500/10',
      iconBorder: 'border-emerald-500/20',
      iconText: 'text-emerald-400',
      hoverBorder: 'hover:border-emerald-500/30',
    },
    violet: {
      iconBg: 'bg-violet-500/10',
      iconBorder: 'border-violet-500/20',
      iconText: 'text-violet-400',
      hoverBorder: 'hover:border-violet-500/30',
    },
    amber: {
      iconBg: 'bg-amber-500/10',
      iconBorder: 'border-amber-500/20',
      iconText: 'text-amber-400',
      hoverBorder: 'hover:border-amber-500/30',
    },
  } as const;

  return (
    <div className="cs-page min-h-screen min-h-[100dvh] w-full flex flex-col items-center justify-start bg-[#060911] relative overflow-x-hidden overflow-y-auto safe-top text-slate-100 selection:bg-indigo-500/30">
      {/* Fixed background ambient lights & grid - zero scroll lag, no horizontal shift */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0" aria-hidden="true">
        <div className="cs-orb cs-orb-1" />
        <div className="cs-orb cs-orb-2" />
        <div className="cs-orb cs-orb-3" />
        <div className="absolute inset-0 cs-grid-overlay" />
      </div>

      {/* Top utility bar */}
      <header className="w-full max-w-md mx-auto flex items-center justify-between px-4 pt-3 pb-1 relative z-10 shrink-0">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-medium text-emerald-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 status-pulse" />
          <span>{t('serviceOnlineStatus')}</span>
        </div>

        {languageSelectionEnabled && (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-white/10 hover:border-white/20 hover:bg-white/5 active:scale-95 text-slate-300 text-[11px] font-medium transition-all cursor-pointer"
            onClick={handleToggleLanguage}
            aria-label={t('switchLang')}
          >
            <Globe className="w-3.5 h-3.5 text-indigo-400" />
            <span>{t('switchLang')}</span>
          </button>
        )}
      </header>

      {/* Main content container */}
      <main className="w-full max-w-md mx-auto flex flex-col items-center px-4 pt-3 pb-[calc(2rem+env(safe-area-inset-bottom,0px))] relative z-10 flex-1">
        {/* User Identity / Avatar Header */}
        <section className="flex flex-col items-center pt-2 sm:pt-4 pb-5 text-center">
          {/* Avatar with breathing halo */}
          <div className="relative mb-3.5 cs-avatar-entrance">
            <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-indigo-500/40 via-violet-500/40 to-pink-500/40 blur-xl cs-breathe" />
            <div className="relative w-[70px] h-[70px] sm:w-[76px] sm:h-[76px] rounded-full p-[2px] bg-gradient-to-tr from-indigo-500 via-violet-500 to-pink-500 shadow-xl shadow-indigo-950/50">
              <div className="w-full h-full rounded-full overflow-hidden bg-[#0a0e1c] flex items-center justify-center border border-white/10">
                {user.photo_url ? (
                  <img
                    src={user.photo_url}
                    alt={displayName}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : initials ? (
                  <span className="text-lg sm:text-xl font-bold font-mono tracking-wider text-white">
                    {initials}
                  </span>
                ) : (
                  <User className="w-7 h-7 text-slate-400" />
                )}
              </div>
            </div>

            {user.is_premium && (
              <div
                className="absolute -bottom-0.5 -end-0.5 w-5 h-5 rounded-full bg-gradient-to-tr from-amber-400 to-amber-500 border-2 border-[#060911] flex items-center justify-center shadow-md shadow-amber-500/30"
                title={t('premiumUserBadge')}
              >
                <Star className="w-3 h-3 text-slate-950 fill-slate-950" />
              </div>
            )}
          </div>

          {/* User greeting */}
          <h1 className="text-xl sm:text-2xl font-bold text-white mb-2 tracking-tight flex items-center justify-center gap-1.5 flex-wrap cs-fade-in">
            <span>{locale === 'fa' ? 'سلام،' : 'Hello,'}</span>
            <bdi className="bg-gradient-to-r from-white via-indigo-100 to-violet-200 bg-clip-text text-transparent font-extrabold">
              {displayName}
            </bdi>
            <span className="animate-wave select-none text-lg">👋</span>
          </h1>

          {/* Badges / ID pill */}
          <div className="flex flex-wrap items-center justify-center gap-1.5 cs-fade-in-delay-1">
            <button
              type="button"
              onClick={handleCopyId}
              className="inline-flex items-center gap-1.5 bg-white/[0.04] hover:bg-white/[0.08] active:scale-[0.97] border border-white/[0.08] hover:border-indigo-400/40 px-3 py-1 rounded-full text-xs transition-all cursor-pointer select-none group"
              title={t('copy')}
            >
              <span className="text-slate-400 text-[11px]">{t('telegramId')}</span>
              <code dir="ltr" className="font-mono font-semibold text-slate-200 text-xs">
                {user.id}
              </code>
              {copied ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span>{t('copiedId')}</span>
                </span>
              ) : (
                <Copy className="w-3 h-3 text-slate-400 group-hover:text-indigo-300 transition-colors" />
              )}
            </button>

            {user.username && (
              <div
                dir="ltr"
                className="inline-flex items-center gap-0.5 bg-white/[0.04] border border-white/[0.08] px-2.5 py-1 rounded-full text-[11px] text-slate-300 font-mono select-none"
              >
                <span className="text-indigo-400">@</span>
                <span>{user.username}</span>
              </div>
            )}

            {user.is_premium && (
              <div className="inline-flex items-center gap-1 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-full text-[11px] text-amber-300 font-medium select-none">
                <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />
                <span>{t('premiumUserBadge')}</span>
              </div>
            )}
          </div>
        </section>

        {/* Hero Card: Coming Soon */}
        <section className="w-full rounded-2xl p-4 sm:p-5 mb-4 relative overflow-hidden border border-white/[0.08] bg-white/[0.025] backdrop-blur-md cs-fade-in-delay-2 text-start">
          {/* Subtle top accent gradient */}
          <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-indigo-500/40 to-transparent" />

          <div className="flex items-center gap-2 mb-2.5">
            <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/15 border border-indigo-500/25 text-indigo-300">
              <Sparkles className="w-3 h-3 text-indigo-400" />
              <span>{t('userPortalBadge')}</span>
            </div>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 border border-amber-500/20 text-amber-300">
              <span className="w-1 h-1 rounded-full bg-amber-400 animate-pulse" />
              <span>{t('inDevelopmentStatus')}</span>
            </span>
          </div>

          <h2 className="text-base sm:text-[17px] font-bold text-white mb-1.5 leading-snug">
            {t('portalTitle')}
          </h2>

          <p className="text-xs sm:text-[13px] text-slate-300/90 leading-relaxed m-0">
            {t('portalDesc')}
          </p>
        </section>

        {/* Upcoming features roadmap list */}
        <section className="w-full mb-4 cs-fade-in-delay-3">
          <div className="flex items-center justify-between mb-2.5 px-0.5">
            <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              {t('upcomingFeaturesTitle')}
            </h3>
            <span className="text-[10px] text-slate-500 font-medium">
              {t('inDevelopmentStatus')}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {features.map((feat, i) => {
              const colors = colorMap[feat.color];
              const Icon = feat.icon;
              return (
                <div
                  key={i}
                  className={`rounded-xl p-3 bg-white/[0.02] border border-white/[0.06] ${colors.hoverBorder} transition-all flex items-center gap-3`}
                >
                  <div
                    className={`w-9 h-9 rounded-xl ${colors.iconBg} border ${colors.iconBorder} flex items-center justify-center shrink-0 ${colors.iconText}`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0 text-start">
                    <h4 className="text-[13px] font-semibold text-slate-200 mb-0.5 leading-tight">
                      {t(feat.titleKey)}
                    </h4>
                    <p className="text-[11px] text-slate-400 leading-snug m-0">{t(feat.descKey)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Notice: bot is active now */}
        <section className="w-full rounded-xl p-3.5 mb-5 bg-emerald-500/[0.05] border border-emerald-500/15 flex items-start gap-3 text-start cs-fade-in-delay-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0 text-emerald-400 mt-0.5">
            <Bot className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-xs font-semibold text-emerald-300 mb-0.5">
              {t('currentServicesReadyTitle')}
            </h4>
            <p className="text-[11px] text-slate-300/90 leading-relaxed m-0">
              {t('currentServicesReadyDesc')}
            </p>
          </div>
        </section>

        {/* Bottom CTA Action Button */}
        <footer className="w-full flex flex-col items-center gap-2 mt-auto cs-fade-in-delay-3">
          <button
            type="button"
            className="w-full h-12 text-sm font-bold bg-gradient-to-r from-indigo-500 via-indigo-600 to-violet-600 hover:from-indigo-600 hover:to-violet-700 active:scale-[0.98] text-white rounded-xl shadow-lg shadow-indigo-950/40 border-0 flex items-center justify-center gap-2 transition-all cursor-pointer"
            onClick={handleClose}
          >
            <Send className="w-4 h-4 rtl:rotate-180" />
            <span>{t('backToBot')}</span>
          </button>
          <span className="text-[11px] text-slate-500 select-none">{t('closeMiniAppHint')}</span>
        </footer>
      </main>
    </div>
  );
};
