import React from 'react';
import { User, Star, Copy, Check, Sparkles } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import type { TelegramWebAppUser } from '@/shared/types/telegram.js';

interface UserHeroCardProps {
  user: TelegramWebAppUser;
  onCopyId: () => void;
  isCopied: boolean;
}

export const UserHeroCard: React.FC<UserHeroCardProps> = ({ user, onCopyId, isCopied }) => {
  const { t, locale } = useLanguage();
  const { sanitizeDisplayName } = useFormatters();
  const { isDark } = useThemeTokens();

  const { displayName, initials } = sanitizeDisplayName(
    user.first_name,
    user.last_name,
    t('user.guestUser')
  );

  return (
    <>
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
              title={t('user.premiumUserBadge')}
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
            onClick={onCopyId}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs transition-all active:scale-[0.97] cursor-pointer select-none group border ${
              isDark
                ? 'bg-white/[0.04] hover:bg-white/[0.08] border-white/10 text-slate-300'
                : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700 shadow-xs'
            }`}
            title={t('common.copy')}
          >
            <span className={`text-[11px] ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
              {t('user.telegramId')}
            </span>
            <code
              dir="ltr"
              className={`font-mono font-semibold text-xs ${isDark ? 'text-zinc-200' : 'text-slate-800'}`}
            >
              {user.id}
            </code>
            {isCopied ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-500">
                <Check className="w-3 h-3 text-emerald-500" />
                <span>{t('user.copiedId')}</span>
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
              <span>{t('user.premiumUserBadge')}</span>
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
            <span>{t('user.userPortalBadge')}</span>
          </div>
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
              isDark
                ? 'bg-amber-500/10 border-amber-500/20 text-amber-300'
                : 'bg-amber-50 border-amber-200 text-amber-800'
            }`}
          >
            <span className="w-1 h-1 rounded-full bg-amber-500 animate-pulse" />
            <span>{t('user.inDevelopmentStatus')}</span>
          </span>
        </div>

        <h2
          className={`text-base sm:text-[17px] font-bold mb-1.5 leading-snug ${
            isDark ? 'text-white' : 'text-slate-900'
          }`}
        >
          {t('user.portalTitle')}
        </h2>

        <p
          className={`text-xs sm:text-[13px] leading-relaxed m-0 ${
            isDark ? 'text-zinc-400' : 'text-slate-600'
          }`}
        >
          {t('user.portalDesc')}
        </p>
      </section>
    </>
  );
};
