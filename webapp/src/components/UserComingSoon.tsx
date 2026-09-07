import React, { useState, useEffect } from 'react';
import type { TelegramWebAppUser } from '../types/telegram.js';
import { useLanguage } from '../i18n/LanguageContext.js';
import { useTheme } from '../theme/ThemeContext.js';
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
  Moon,
  Sun,
} from 'lucide-react';

interface UserComingSoonProps {
  user: TelegramWebAppUser;
}

export const UserComingSoon: React.FC<UserComingSoonProps> = ({ user }) => {
  const { t, locale, languageSelectionEnabled, setLocale } = useLanguage();
  const { isDark, toggleTheme } = useTheme();
  const [copied, setCopied] = useState(false);

  const handleClose = () => {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('medium');
    if (window.Telegram?.WebApp?.close) {
      window.Telegram.WebApp.close();
    } else {
      window.close();
    }
  };

  // Connect native Telegram WebApp BackButton and disable accidental vertical swipes
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg?.disableVerticalSwipes) {
      tg.disableVerticalSwipes();
    }

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
    },
    {
      icon: Activity,
      titleKey: 'featureTrafficTitle' as const,
      descKey: 'featureTrafficDesc' as const,
    },
    {
      icon: QrCode,
      titleKey: 'featureConfigsTitle' as const,
      descKey: 'featureConfigsDesc' as const,
    },
    {
      icon: Wallet,
      titleKey: 'featureWalletTitle' as const,
      descKey: 'featureWalletDesc' as const,
    },
  ];

  return (
    <div
      className={`cs-page w-full min-h-screen min-h-[100dvh] flex flex-col items-center justify-start safe-top transition-colors duration-200 ${
        isDark ? 'bg-[#090a0f] text-slate-100' : 'bg-[#f8fafc] text-slate-900'
      }`}
    >
      {/* Fixed background ambient lights & grid - zero scroll lag, hardware accelerated */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0" aria-hidden="true">
        <div className="cs-orb cs-orb-1" />
        <div className="cs-orb cs-orb-2" />
        <div className="cs-orb cs-orb-3" />
        <div className="absolute inset-0 cs-grid-overlay" />
      </div>

      {/* Top utility bar */}
      <header className="w-full max-w-md mx-auto flex items-center justify-between px-4 pt-3.5 pb-1 relative z-10 shrink-0">
        {/* Online status indicator */}
        <div
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
            isDark
              ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
              : 'bg-emerald-50 border border-emerald-200 text-emerald-700'
          }`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 status-pulse" />
          <span>{t('serviceOnlineStatus')}</span>
        </div>

        {/* Right utility buttons: Theme switch & Language */}
        <div className="flex items-center gap-1.5">
          {/* Theme toggle button */}
          <button
            type="button"
            className={`inline-flex items-center justify-center w-8 h-8 rounded-full border transition-all active:scale-95 cursor-pointer ${
              isDark
                ? 'bg-white/[0.04] border-white/10 hover:bg-white/10 text-slate-300'
                : 'bg-white border-slate-200 hover:bg-slate-100 text-slate-700 shadow-sm'
            }`}
            onClick={toggleTheme}
            aria-label={t('themeToggle')}
            title={isDark ? t('themeLight') : t('themeDark')}
          >
            {isDark ? (
              <Sun className="w-4 h-4 text-amber-300" />
            ) : (
              <Moon className="w-4 h-4 text-slate-700" />
            )}
          </button>

          {/* Language toggle button */}
          {languageSelectionEnabled && (
            <button
              type="button"
              className={`inline-flex items-center gap-1.5 px-3 py-1 h-8 rounded-full border text-[11px] font-medium transition-all active:scale-95 cursor-pointer ${
                isDark
                  ? 'bg-white/[0.04] border-white/10 hover:bg-white/10 text-slate-300'
                  : 'bg-white border-slate-200 hover:bg-slate-100 text-slate-700 shadow-sm'
              }`}
              onClick={handleToggleLanguage}
              aria-label={t('switchLang')}
            >
              <Globe className="w-3.5 h-3.5 opacity-70" />
              <span>{t('switchLang')}</span>
            </button>
          )}
        </div>
      </header>

      {/* Main content container (natural scroll, safe padding for notch and home bar) */}
      <main className="w-full max-w-md mx-auto flex flex-col items-center px-4 pt-3 pb-[calc(2.5rem+env(safe-area-inset-bottom,0px))] relative z-10 flex-1">
        {/* User Identity Section */}
        <section className="flex flex-col items-center pt-2 sm:pt-4 pb-5 text-center">
          {/* Avatar */}
          <div className="relative mb-3.5 cs-avatar-entrance">
            <div
              className={`absolute inset-0 rounded-full blur-xl cs-breathe ${
                isDark
                  ? 'bg-gradient-to-tr from-zinc-700/40 via-zinc-500/30 to-zinc-800/40'
                  : 'bg-gradient-to-tr from-slate-300/60 via-slate-200/50 to-slate-400/40'
              }`}
            />
            <div
              className={`relative w-[72px] h-[72px] sm:w-[78px] sm:h-[78px] rounded-full p-[2px] transition-colors ${
                isDark
                  ? 'bg-gradient-to-tr from-zinc-600 via-zinc-400 to-zinc-700 shadow-xl shadow-black/60'
                  : 'bg-gradient-to-tr from-slate-300 via-slate-400 to-slate-200 shadow-lg shadow-slate-200'
              }`}
            >
              <div
                className={`w-full h-full rounded-full overflow-hidden flex items-center justify-center border transition-colors ${
                  isDark ? 'bg-[#0f1118] border-white/10' : 'bg-slate-100 border-slate-200'
                }`}
              >
                {user.photo_url ? (
                  <img
                    src={user.photo_url}
                    alt={displayName}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : initials ? (
                  <span
                    className={`text-lg sm:text-xl font-bold font-mono tracking-wider ${
                      isDark ? 'text-white' : 'text-slate-800'
                    }`}
                  >
                    {initials}
                  </span>
                ) : (
                  <User className={`w-7 h-7 ${isDark ? 'text-zinc-400' : 'text-slate-500'}`} />
                )}
              </div>
            </div>

            {user.is_premium && (
              <div
                className="absolute -bottom-0.5 -end-0.5 w-5 h-5 rounded-full bg-gradient-to-tr from-amber-400 to-amber-500 border-2 border-[#090a0f] flex items-center justify-center shadow-md shadow-amber-500/30"
                title={t('premiumUserBadge')}
              >
                <Star className="w-3 h-3 text-slate-950 fill-slate-950" />
              </div>
            )}
          </div>

          {/* User greeting */}
          <h1
            className={`text-xl sm:text-2xl font-bold mb-2 tracking-tight flex items-center justify-center gap-1.5 flex-wrap cs-fade-in ${
              isDark ? 'text-white' : 'text-slate-900'
            }`}
          >
            <span>{locale === 'fa' ? 'سلام،' : 'Hello,'}</span>
            <bdi
              className={
                isDark
                  ? 'bg-gradient-to-r from-white via-zinc-200 to-zinc-400 bg-clip-text text-transparent font-extrabold'
                  : 'text-slate-950 font-extrabold'
              }
            >
              {displayName}
            </bdi>
            <span className="animate-wave select-none text-lg">👋</span>
          </h1>

          {/* User chips: ID, username, premium */}
          <div className="flex flex-wrap items-center justify-center gap-1.5 cs-fade-in-delay-1">
            <button
              type="button"
              onClick={handleCopyId}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs transition-all active:scale-[0.97] cursor-pointer select-none group border ${
                isDark
                  ? 'bg-white/[0.04] hover:bg-white/[0.08] border-white/10 text-slate-300'
                  : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700 shadow-xs'
              }`}
              title={t('copy')}
            >
              <span className={`text-[11px] ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                {t('telegramId')}
              </span>
              <code
                dir="ltr"
                className={`font-mono font-semibold text-xs ${isDark ? 'text-zinc-200' : 'text-slate-800'}`}
              >
                {user.id}
              </code>
              {copied ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-500">
                  <Check className="w-3 h-3 text-emerald-500" />
                  <span>{t('copiedId')}</span>
                </span>
              ) : (
                <Copy
                  className={`w-3 h-3 transition-colors ${
                    isDark
                      ? 'text-zinc-400 group-hover:text-white'
                      : 'text-slate-400 group-hover:text-slate-900'
                  }`}
                />
              )}
            </button>

            {user.username && (
              <div
                dir="ltr"
                className={`inline-flex items-center gap-0.5 border px-2.5 py-1 rounded-full text-[11px] font-mono select-none ${
                  isDark
                    ? 'bg-white/[0.04] border-white/10 text-zinc-300'
                    : 'bg-white border-slate-200 text-slate-700 shadow-xs'
                }`}
              >
                <span className={isDark ? 'text-zinc-400' : 'text-slate-400'}>@</span>
                <span>{user.username}</span>
              </div>
            )}

            {user.is_premium && (
              <div
                className={`inline-flex items-center gap-1 border px-2.5 py-1 rounded-full text-[11px] font-medium select-none ${
                  isDark
                    ? 'bg-amber-500/10 border-amber-500/20 text-amber-300'
                    : 'bg-amber-50 border-amber-200 text-amber-800'
                }`}
              >
                <Star className="w-2.5 h-2.5 fill-amber-500 text-amber-500" />
                <span>{t('premiumUserBadge')}</span>
              </div>
            )}
          </div>
        </section>

        {/* Hero Card: Coming Soon announcement */}
        <section
          className={`w-full rounded-2xl p-4 sm:p-5 mb-4 relative overflow-hidden border backdrop-blur-md cs-fade-in-delay-2 text-start transition-colors ${
            isDark
              ? 'bg-white/[0.025] border-white/[0.08] text-white shadow-xl shadow-black/20'
              : 'bg-white border-slate-200/90 text-slate-900 shadow-sm'
          }`}
        >
          {/* Subtle top accent line */}
          <div
            className={`absolute top-0 inset-x-0 h-px ${
              isDark
                ? 'bg-gradient-to-r from-transparent via-zinc-400/30 to-transparent'
                : 'bg-gradient-to-r from-transparent via-slate-300 to-transparent'
            }`}
          />

          <div className="flex items-center gap-2 mb-2.5">
            <div
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${
                isDark
                  ? 'bg-white/[0.06] border-white/10 text-zinc-300'
                  : 'bg-slate-100 border-slate-200 text-slate-700'
              }`}
            >
              <Sparkles className={`w-3 h-3 ${isDark ? 'text-zinc-300' : 'text-slate-600'}`} />
              <span>{t('userPortalBadge')}</span>
            </div>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                isDark
                  ? 'bg-amber-500/10 border-amber-500/20 text-amber-300'
                  : 'bg-amber-50 border-amber-200 text-amber-800'
              }`}
            >
              <span className="w-1 h-1 rounded-full bg-amber-500 animate-pulse" />
              <span>{t('inDevelopmentStatus')}</span>
            </span>
          </div>

          <h2
            className={`text-base sm:text-[17px] font-bold mb-1.5 leading-snug ${
              isDark ? 'text-white' : 'text-slate-900'
            }`}
          >
            {t('portalTitle')}
          </h2>

          <p
            className={`text-xs sm:text-[13px] leading-relaxed m-0 ${
              isDark ? 'text-zinc-400' : 'text-slate-600'
            }`}
          >
            {t('portalDesc')}
          </p>
        </section>

        {/* Feature Roadmap List */}
        <section className="w-full mb-4 cs-fade-in-delay-3">
          <div className="flex items-center justify-between mb-2.5 px-0.5">
            <h3
              className={`text-[11px] font-bold uppercase tracking-wider ${
                isDark ? 'text-zinc-400' : 'text-slate-500'
              }`}
            >
              {t('upcomingFeaturesTitle')}
            </h3>
            <span
              className={`text-[10px] font-medium ${isDark ? 'text-zinc-500' : 'text-slate-400'}`}
            >
              {t('inDevelopmentStatus')}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {features.map((feat, i) => {
              const Icon = feat.icon;
              return (
                <div
                  key={i}
                  className={`rounded-xl p-3 border transition-all flex items-center gap-3 ${
                    isDark
                      ? 'bg-white/[0.02] border-white/[0.06] hover:border-white/[0.12]'
                      : 'bg-white border-slate-200/80 hover:border-slate-300 shadow-2xs'
                  }`}
                >
                  <div
                    className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 transition-transform ${
                      isDark
                        ? 'bg-white/[0.05] border-white/10 text-zinc-300'
                        : 'bg-slate-100 border-slate-200 text-slate-700'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0 text-start">
                    <h4
                      className={`text-[13px] font-semibold mb-0.5 leading-tight ${
                        isDark ? 'text-zinc-200' : 'text-slate-900'
                      }`}
                    >
                      {t(feat.titleKey)}
                    </h4>
                    <p
                      className={`text-[11px] leading-snug m-0 ${
                        isDark ? 'text-zinc-400' : 'text-slate-500'
                      }`}
                    >
                      {t(feat.descKey)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Notice: Services ready in bot */}
        <section
          className={`w-full rounded-xl p-3.5 mb-5 border flex items-start gap-3 text-start cs-fade-in-delay-3 transition-colors ${
            isDark
              ? 'bg-emerald-500/[0.04] border-emerald-500/15'
              : 'bg-emerald-50/70 border-emerald-200'
          }`}
        >
          <div
            className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 mt-0.5 ${
              isDark
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                : 'bg-emerald-100/70 border-emerald-300 text-emerald-700'
            }`}
          >
            <Bot className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <h4
              className={`text-xs font-semibold mb-0.5 ${
                isDark ? 'text-emerald-300' : 'text-emerald-900'
              }`}
            >
              {t('currentServicesReadyTitle')}
            </h4>
            <p
              className={`text-[11px] leading-relaxed m-0 ${
                isDark ? 'text-zinc-300' : 'text-emerald-800/90'
              }`}
            >
              {t('currentServicesReadyDesc')}
            </p>
          </div>
        </section>

        {/* Bottom CTA Action Button */}
        <footer className="w-full flex flex-col items-center gap-2 mt-auto cs-fade-in-delay-3">
          <button
            type="button"
            className={`w-full h-12 text-sm font-bold active:scale-[0.98] rounded-xl border-0 flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md ${
              isDark
                ? 'bg-white text-black hover:bg-zinc-200'
                : 'bg-slate-900 text-white hover:bg-slate-800'
            }`}
            onClick={handleClose}
          >
            <Send className="w-4 h-4 rtl:rotate-180" />
            <span>{t('backToBot')}</span>
          </button>
          <span
            className={`text-[11px] select-none ${isDark ? 'text-zinc-500' : 'text-slate-400'}`}
          >
            {t('closeMiniAppHint')}
          </span>
        </footer>
      </main>
    </div>
  );
};
