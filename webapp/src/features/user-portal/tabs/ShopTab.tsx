import React, { useEffect, useState } from 'react';
import {
  ShoppingBag,
  Zap,
  Sparkles,
  Sliders,
  Plus,
  Minus,
  Send,
  ShieldCheck,
  Package,
} from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { api } from '@/shared/lib/api.js';
import type { UserPackageItem, CustomVolumeSettings } from '@/shared/types/userPortal.js';

interface ShopTabProps {
  packages: UserPackageItem[];
  currency?: string;
  customVolumeSettings?: CustomVolumeSettings;
  botUsername?: string;
  onSelectPackage: (pkg: UserPackageItem) => void;
}

const PRESET_GB_OPTIONS = [10, 20, 30, 50, 100, 200];

export const ShopTab: React.FC<ShopTabProps> = ({
  packages,
  currency: propCurrency,
  customVolumeSettings,
  botUsername,
  onSelectPackage,
}) => {
  const { t } = useLanguage();
  const { isDark, cardClass } = useThemeTokens();
  const { formatToman } = useFormatters();
  const { triggerHaptic } = useHaptic();

  const currency = propCurrency || t('common.currency');

  const isCustomEnabled = customVolumeSettings?.enabled !== false;
  const minGb = customVolumeSettings?.minGb ?? 5;
  const maxGb = customVolumeSettings?.maxGb ?? 300;
  const pricePerGb = customVolumeSettings?.pricePerGb ?? 5000;
  const pricePerDay = customVolumeSettings?.pricePerDay ?? 0;
  const defaultDays = customVolumeSettings?.defaultDays ?? 30;

  const [customGb, setCustomGb] = useState<number>(() => Math.min(Math.max(30, minGb), maxGb));
  const [typedGb, setTypedGb] = useState<string>(() =>
    String(Math.min(Math.max(30, minGb), maxGb))
  );
  const [customDays] = useState<number>(defaultDays);
  const [serverQuote, setServerQuote] = useState<number | null>(null);

  // Linear calculation fallback
  const linearPrice = Math.max(0, customGb * pricePerGb + customDays * pricePerDay);
  const customPrice = serverQuote !== null ? serverQuote : linearPrice;

  // Debounced server-side quote fetcher
  useEffect(() => {
    if (!isCustomEnabled) return;
    let isCancelled = false;

    const timer = setTimeout(async () => {
      try {
        const quote = await api.getUserQuote(customGb, customDays);
        if (!isCancelled) {
          setServerQuote(quote.totalPrice);
        }
      } catch {
        if (!isCancelled) {
          setServerQuote(null);
        }
      }
    }, 250);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [customGb, customDays, isCustomEnabled]);

  const handleSelect = (pkg: UserPackageItem) => {
    triggerHaptic('selection');
    onSelectPackage(pkg);
  };

  const handleCustomGbChange = (val: number) => {
    const clamped = Math.min(Math.max(val, minGb), maxGb);
    setCustomGb(clamped);
    setTypedGb(String(clamped));
  };

  const handleTypedGbChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setTypedGb(raw);
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed)) {
      const clamped = Math.min(Math.max(parsed, minGb), maxGb);
      setCustomGb(clamped);
    }
  };

  const handleTypedGbBlur = () => {
    let parsed = parseInt(typedGb, 10);
    if (isNaN(parsed)) {
      parsed = minGb;
    }
    const clamped = Math.min(Math.max(parsed, minGb), maxGb);
    setCustomGb(clamped);
    setTypedGb(String(clamped));
  };

  const handleOrderCustom = () => {
    triggerHaptic('medium');
    const customPkg: UserPackageItem = {
      id: 'custom',
      name: `${customGb} GB (${customDays} days)`,
      gbAmount: customGb,
      durationDays: customDays,
      price: customPrice,
    };
    onSelectPackage(customPkg);
  };

  const handleOpenBotCustom = () => {
    triggerHaptic('medium');
    const cleanBot = botUsername?.replace(/^@/, '');
    if (cleanBot) {
      const url = `https://t.me/${cleanBot}?start=custom`;
      if (window.Telegram?.WebApp?.openTelegramLink) {
        window.Telegram.WebApp.openTelegramLink(url);
        setTimeout(() => window.Telegram?.WebApp?.close?.(), 300);
        return;
      }
    }
    handleOrderCustom();
  };

  const validPresets = PRESET_GB_OPTIONS.filter((val) => val >= minGb && val <= maxGb);

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

      {/* Custom Volume Calculator Section */}
      {isCustomEnabled && (
        <section
          className={`rounded-2xl p-4 sm:p-5 border transition-all text-start relative overflow-hidden ${
            isDark
              ? 'bg-gradient-to-br from-indigo-950/40 via-purple-950/20 to-zinc-900/70 border-indigo-500/30 shadow-lg shadow-indigo-950/25'
              : 'bg-gradient-to-br from-indigo-50/90 via-white to-purple-50/70 border-indigo-200 shadow-sm'
          }`}
        >
          {/* Header pill & badge */}
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <div
                className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${
                  isDark
                    ? 'bg-indigo-500/20 border-indigo-500/30 text-indigo-300'
                    : 'bg-indigo-100 border-indigo-200 text-indigo-600'
                }`}
              >
                <Sliders className="w-4 h-4" />
              </div>
              <div className="flex flex-col min-w-0">
                <h3
                  className={`text-xs sm:text-sm font-bold truncate ${
                    isDark ? 'text-white' : 'text-slate-900'
                  }`}
                >
                  {t('user.shop.customVolumeTitle')}
                </h3>
                <span className="text-[11px] text-slate-500 dark:text-zinc-400 truncate">
                  {t('user.shop.customVolumeSubtitle')}
                </span>
              </div>
            </div>

            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/15 text-indigo-500 dark:text-indigo-300 border border-indigo-500/25 shrink-0">
              <Sparkles className="w-2.5 h-2.5" />
              <span>{t('user.shop.customVolumeBadge')}</span>
            </span>
          </div>

          {/* Quick preset chips */}
          {validPresets.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap my-3">
              {validPresets.map((val) => {
                const isSelected = customGb === val;
                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() => {
                      triggerHaptic('selection');
                      handleCustomGbChange(val);
                    }}
                    className={`py-1 px-2.5 rounded-xl text-xs font-semibold border transition-all active:scale-95 cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-xs'
                        : isDark
                          ? 'bg-white/[0.04] border-white/10 hover:bg-white/10 text-zinc-300'
                          : 'bg-white border-slate-200 hover:bg-slate-100 text-slate-700 shadow-2xs'
                    }`}
                  >
                    {val} GB
                  </button>
                );
              })}
            </div>
          )}

          {/* Interactive GB Slider & Stepper */}
          <div
            className={`p-3.5 rounded-xl border flex flex-col gap-3 my-3 ${
              isDark ? 'bg-black/25 border-white/[0.06]' : 'bg-slate-50/80 border-slate-200/80'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-600 dark:text-zinc-400 font-medium">
                {t('user.shop.customVolumeGbLabel')}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={customGb <= minGb}
                  onClick={() => {
                    triggerHaptic('light');
                    handleCustomGbChange(customGb - 5);
                  }}
                  className="w-7 h-7 rounded-lg border flex items-center justify-center transition-all active:scale-90 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed bg-white/5 border-white/10 text-slate-300 hover:bg-white/10"
                  aria-label="Decrease GB"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>

                <div className="flex items-center gap-1 min-w-[75px] justify-center px-1">
                  <input
                    type="number"
                    min={minGb}
                    max={maxGb}
                    value={typedGb}
                    onChange={handleTypedGbChange}
                    onBlur={handleTypedGbBlur}
                    className="w-12 text-center font-mono font-bold text-base sm:text-lg text-indigo-500 dark:text-indigo-400 bg-transparent border-b border-indigo-500/30 focus:border-indigo-500 focus:outline-hidden py-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="text-xs font-normal text-slate-400">GB</span>
                </div>

                <button
                  type="button"
                  disabled={customGb >= maxGb}
                  onClick={() => {
                    triggerHaptic('light');
                    handleCustomGbChange(customGb + 5);
                  }}
                  className="w-7 h-7 rounded-lg border flex items-center justify-center transition-all active:scale-90 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed bg-white/5 border-white/10 text-slate-300 hover:bg-white/10"
                  aria-label="Increase GB"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Range Slider */}
            <input
              type="range"
              min={minGb}
              max={maxGb}
              step={1}
              value={customGb}
              onChange={(e) => handleCustomGbChange(Number(e.target.value))}
              className="range range-indigo range-xs w-full accent-indigo-500 cursor-pointer"
            />

            <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
              <span>{minGb} GB</span>
              <span>{t('user.shop.daysUnit').replace('{days}', String(customDays))}</span>
              <span>{maxGb} GB</span>
            </div>
          </div>

          {/* Pricing summary & Action Buttons */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-slate-200/60 dark:border-white/[0.08]">
            <div className="flex flex-col">
              <div className="flex items-baseline gap-1.5">
                <span
                  className={`text-lg sm:text-xl font-mono font-extrabold ${
                    isDark ? 'text-white' : 'text-slate-900'
                  }`}
                >
                  {formatToman(customPrice)}
                </span>
                <span className="text-xs text-slate-500 dark:text-zinc-400">{currency}</span>
              </div>
              <span className="text-[10px] text-slate-400">
                {t('user.shop.customVolumePricePerGb').replace(
                  '{price}',
                  `${formatToman(pricePerGb)} ${currency}`
                )}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {botUsername && (
                <button
                  type="button"
                  onClick={handleOpenBotCustom}
                  className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer ${
                    isDark
                      ? 'bg-white/[0.05] border-white/10 hover:bg-white/10 text-zinc-300'
                      : 'bg-slate-100 border-slate-200 hover:bg-slate-200 text-slate-700'
                  }`}
                  title={t('user.shop.customVolumeOrderBotButton')}
                >
                  <Send className="w-3.5 h-3.5 rtl:rotate-180" />
                  <span className="hidden sm:inline">
                    {t('user.shop.customVolumeOrderBotButton')}
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={handleOrderCustom}
                className="flex-1 sm:flex-initial py-2.5 px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-md bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white"
              >
                <Zap className="w-4 h-4" />
                <span>{t('user.shop.customVolumeOrderButton')}</span>
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Pre-configured Packages Grid */}
      {packages.length === 0 ? (
        <div
          className={`p-8 rounded-2xl border text-center my-4 flex flex-col items-center justify-center gap-2.5 ${
            isDark
              ? 'bg-white/[0.02] border-white/[0.07] text-zinc-400'
              : 'bg-slate-50 border-slate-200 text-slate-500'
          }`}
        >
          <Package className="w-10 h-10 text-slate-400 opacity-60" />
          <h3 className={`text-sm font-bold m-0 ${isDark ? 'text-zinc-200' : 'text-slate-800'}`}>
            {t('user.shop.emptyPackages')}
          </h3>
          <p className="text-xs text-slate-400 max-w-xs m-0">{t('user.shop.emptyPackagesDesc')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {packages.map((pkg) => (
            <div
              key={pkg.id}
              className={`relative rounded-2xl p-4 sm:p-5 border transition-all flex flex-col justify-between gap-4 text-start ${cardClass} hover:border-indigo-500/30`}
            >
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
                    <span>{t('user.shop.trafficUnit').replace('{gb}', String(pkg.gbAmount))}</span>
                  </span>

                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-slate-500 dark:text-zinc-400 bg-slate-100 dark:bg-white/[0.05] border border-slate-200 dark:border-white/10">
                    {t('user.shop.daysUnit').replace('{days}', String(pkg.durationDays))}
                  </span>
                </div>

                {/* Feature bullet points */}
                <div className="flex flex-col gap-1 mt-1 text-[11px] text-slate-500 dark:text-zinc-400">
                  <div className="flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    <span>{t('user.shop.fastConnectionFeature')}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
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
                  <span className="text-[11px] text-slate-500 dark:text-zinc-400">{currency}</span>
                </div>

                <button
                  type="button"
                  onClick={() => handleSelect(pkg)}
                  className="py-2 px-3.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-sm bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  <span>{t('user.shop.selectPlan')}</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
