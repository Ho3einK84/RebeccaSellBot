import React from 'react';
import { ShoppingBag, Zap, Check, Sparkles } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import type { UserPackageItem } from '@/shared/types/userPortal.js';

interface ShopTabProps {
  packages: UserPackageItem[];
  currency?: string;
  onSelectPackage: (pkg: UserPackageItem) => void;
}

export const ShopTab: React.FC<ShopTabProps> = ({
  packages,
  currency: propCurrency,
  onSelectPackage,
}) => {
  const { t } = useLanguage();
  const { isDark } = useThemeTokens();
  const { formatToman } = useFormatters();
  const { triggerHaptic } = useHaptic();

  const currency = propCurrency || t('common.currency');

  const handleSelect = (pkg: UserPackageItem) => {
    triggerHaptic('selection');
    onSelectPackage(pkg);
  };

  return (
    <div className="w-full flex flex-col gap-4 pb-6">
      {/* Shop Header Banner */}
      <div className="flex flex-col text-start px-1 gap-1">
        <h2
          className={`text-sm sm:text-base font-bold flex items-center gap-2 ${
            isDark ? 'text-white' : 'text-slate-900'
          }`}
        >
          <ShoppingBag className="w-4 h-4 text-indigo-400" />
          <span>{t('user.shop.title')}</span>
        </h2>
        <p className="text-xs text-slate-500 dark:text-zinc-400 m-0">{t('user.shop.desc')}</p>
      </div>

      {/* Packages Grid */}
      {packages.length === 0 ? (
        <div
          className={`p-6 rounded-3xl border text-center my-4 ${
            isDark
              ? 'bg-white/[0.02] border-white/[0.07] text-zinc-400'
              : 'bg-slate-50 border-slate-200 text-slate-500'
          }`}
        >
          {t('common.loading')}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {packages.map((pkg, index) => {
            const isFeatured = index === 1 || packages.length === 1;

            return (
              <div
                key={pkg.id}
                className={`relative rounded-3xl p-4 sm:p-5 border transition-all flex flex-col justify-between gap-4 text-start ${
                  isFeatured
                    ? isDark
                      ? 'bg-gradient-to-b from-indigo-950/40 via-purple-950/20 to-zinc-900/60 border-indigo-500/40 shadow-lg shadow-indigo-950/30'
                      : 'bg-gradient-to-b from-indigo-50/70 via-white to-purple-50/40 border-indigo-300 shadow-sm'
                    : isDark
                      ? 'bg-white/[0.025] border-white/[0.08] hover:border-white/[0.15]'
                      : 'bg-white border-slate-200/90 shadow-2xs hover:border-slate-300'
                }`}
              >
                {/* Popular / Best value badge for featured item */}
                {isFeatured && (
                  <div className="absolute -top-2.5 end-4 px-2.5 py-0.5 rounded-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-[10px] font-bold shadow-xs flex items-center gap-1">
                    <Sparkles className="w-2.5 h-2.5" />
                    <span>{t('user.shop.featuredBadge')}</span>
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <h3
                      className={`text-sm sm:text-base font-bold truncate ${
                        isDark ? 'text-white' : 'text-slate-900'
                      }`}
                    >
                      {pkg.name}
                    </h3>
                  </div>

                  {/* Badges: Traffic & Duration */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-500 dark:text-indigo-300 border border-indigo-500/20">
                      <Zap className="w-3 h-3 text-indigo-400" />
                      <span>
                        {t('user.shop.trafficUnit').replace('{gb}', String(pkg.gbAmount))}
                      </span>
                    </span>

                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-slate-500 dark:text-zinc-400 bg-slate-100 dark:bg-white/[0.05] border border-slate-200 dark:border-white/10">
                      {t('user.shop.daysUnit').replace('{days}', String(pkg.durationDays))}
                    </span>
                  </div>

                  {/* Feature bullet points */}
                  <div className="flex flex-col gap-1 mt-1 text-[11px] text-slate-500 dark:text-zinc-400">
                    <div className="flex items-center gap-1.5">
                      <Check className="w-3 h-3 text-emerald-500 shrink-0" />
                      <span>{t('user.shop.fastConnectionFeature')}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Check className="w-3 h-3 text-emerald-500 shrink-0" />
                      <span>{t('user.shop.allPlatformsFeature')}</span>
                    </div>
                  </div>
                </div>

                {/* Price and CTA */}
                <div className="flex items-center justify-between pt-3 border-t border-slate-200/60 dark:border-white/[0.08] gap-2">
                  <div className="flex items-baseline gap-1">
                    <span
                      className={`text-base sm:text-lg font-mono font-extrabold ${
                        isDark ? 'text-white' : 'text-slate-950'
                      }`}
                    >
                      {formatToman(pkg.price)}
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-zinc-400">
                      {currency}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleSelect(pkg)}
                    className={`py-2 px-3.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-sm ${
                      isFeatured
                        ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                        : isDark
                          ? 'bg-white/[0.08] hover:bg-white/15 text-white border border-white/10'
                          : 'bg-slate-900 hover:bg-slate-800 text-white'
                    }`}
                  >
                    <span>{t('user.shop.selectPlan')}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
