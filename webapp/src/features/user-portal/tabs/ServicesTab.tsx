import React from 'react';
import { Wifi, Copy, Check, QrCode, Calendar, ShieldCheck, ShoppingBag } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import type { UserConfigRecord } from '@/shared/types/userPortal.js';

interface ServicesTabProps {
  configs: UserConfigRecord[];
  onOpenQr: (subUrl: string, configUsername: string) => void;
  onGoToShop: () => void;
  onNotify: (message: string) => void;
}

export const ServicesTab: React.FC<ServicesTabProps> = ({
  configs,
  onOpenQr,
  onGoToShop,
  onNotify,
}) => {
  const { t, isRtl } = useLanguage();
  const { isDark } = useThemeTokens();
  const { copy, isCopied } = useCopy();
  const { triggerHaptic } = useHaptic();

  const handleCopySub = (subUrl: string, id: string) => {
    triggerHaptic('light');
    copy(subUrl, id);
    onNotify(t('user.services.linkCopied'));
  };

  const handleQrClick = (subUrl: string, username: string) => {
    triggerHaptic('selection');
    onOpenQr(subUrl, username);
  };

  const calculateDaysRemaining = (expireTimestampSec: number | null): number | null => {
    if (!expireTimestampSec) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    const diffSec = expireTimestampSec - nowSec;
    if (diffSec <= 0) return 0;
    return Math.ceil(diffSec / 86400);
  };

  return (
    <div className="w-full flex flex-col gap-4 pb-6">
      <div className="flex items-center justify-between px-1">
        <h2
          className={`text-sm font-bold flex items-center gap-2 ${
            isDark ? 'text-white' : 'text-slate-900'
          }`}
        >
          <Wifi className="w-4 h-4 text-indigo-400" />
          <span>{t('user.services.title')}</span>
          <span className="text-xs font-mono font-bold text-indigo-500">({configs.length})</span>
        </h2>

        {configs.length > 0 && (
          <button
            type="button"
            onClick={onGoToShop}
            className="text-xs font-semibold text-indigo-500 hover:text-indigo-400 flex items-center gap-1 cursor-pointer"
          >
            <ShoppingBag className="w-3.5 h-3.5" />
            <span>{t('user.dashboard.buyService')}</span>
          </button>
        )}
      </div>

      {configs.length === 0 ? (
        <div
          className={`p-6 rounded-3xl border text-center flex flex-col items-center gap-3 my-4 ${
            isDark
              ? 'bg-white/[0.02] border-white/[0.07]'
              : 'bg-white border-slate-200/80 shadow-2xs'
          }`}
        >
          <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
            <ShieldCheck className="w-7 h-7" />
          </div>
          <h3 className={`text-sm font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>
            {t('user.services.emptyTitle')}
          </h3>
          <p className="text-xs text-slate-500 dark:text-zinc-400 max-w-xs m-0">
            {t('user.services.emptyDesc')}
          </p>
          <button
            type="button"
            onClick={onGoToShop}
            className="mt-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-md"
          >
            <ShoppingBag className="w-4 h-4" />
            <span>{t('user.services.buyFirst')}</span>
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {configs.map((c) => {
            const usedGb = c.panelUsedTraffic
              ? Number((c.panelUsedTraffic / (1024 * 1024 * 1024)).toFixed(1))
              : 0;
            const limitGb = c.panelDataLimit
              ? Number((c.panelDataLimit / (1024 * 1024 * 1024)).toFixed(0))
              : 0;
            const percent = limitGb > 0 ? Math.min(100, Math.round((usedGb / limitGb) * 100)) : 0;
            const daysLeft = calculateDaysRemaining(c.panelExpire);
            const isSubCopied = isCopied(`sub-${c.id}`);

            return (
              <div
                key={c.id}
                className={`p-4 rounded-2xl border flex flex-col gap-3 text-start transition-all ${
                  isDark
                    ? 'bg-white/[0.03] border-white/[0.08] hover:border-white/[0.15]'
                    : 'bg-white border-slate-200/90 shadow-2xs hover:border-slate-300'
                }`}
              >
                {/* Header: Name and Status */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                    <span
                      className={`text-xs sm:text-sm font-mono font-bold truncate ${
                        isDark ? 'text-white' : 'text-slate-900'
                      }`}
                    >
                      {c.configUsername}
                    </span>
                  </div>

                  <span
                    className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full shrink-0 border ${
                      c.panelStatus === 'active'
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                    }`}
                  >
                    {c.panelStatus === 'active'
                      ? t('user.services.statusActive')
                      : t('user.services.statusLimited')}
                  </span>
                </div>

                {/* Traffic Usage Bar */}
                {limitGb > 0 ? (
                  <div className="w-full flex flex-col gap-1.5">
                    <div className="flex justify-between items-center text-[11px] text-slate-500 dark:text-zinc-400">
                      <span>{t('user.services.trafficUsed')}</span>
                      <span className="font-mono font-semibold">
                        {usedGb} / {limitGb} GB ({percent}%)
                      </span>
                    </div>

                    <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          percent > 90
                            ? 'bg-rose-500'
                            : percent > 75
                              ? 'bg-amber-500'
                              : 'bg-indigo-500'
                        }`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-500 dark:text-zinc-400 flex items-center gap-1">
                    <span>{t('user.services.trafficUsed')}:</span>
                    <span className="font-semibold">{t('user.services.unlimited')}</span>
                  </div>
                )}

                {/* Expiration Info */}
                <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-zinc-400 pt-1 border-t border-slate-200/50 dark:border-white/[0.05]">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>
                      {daysLeft !== null
                        ? daysLeft === 0
                          ? t('user.services.expired')
                          : t('user.services.remainingDays').replace('{days}', String(daysLeft))
                        : '—'}
                    </span>
                  </div>

                  <span className="text-[10px] text-slate-400 font-mono">
                    {new Date(c.createdAt).toLocaleDateString(isRtl ? 'fa-IR' : 'en-US')}
                  </span>
                </div>

                {/* Actions: Copy Sub Link & QR Code */}
                {c.subUrl && (
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleCopySub(c.subUrl!, `sub-${c.id}`)}
                      className={`flex-1 py-2 px-3 rounded-xl font-medium text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer ${
                        isSubCopied
                          ? 'bg-emerald-600 text-white'
                          : isDark
                            ? 'bg-white/[0.06] hover:bg-white/10 text-white border border-white/10'
                            : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200'
                      }`}
                    >
                      {isSubCopied ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>{t('user.services.linkCopied')}</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>{t('user.services.copyLink')}</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleQrClick(c.subUrl!, c.configUsername)}
                      className={`p-2 rounded-xl border flex items-center justify-center transition-all active:scale-95 cursor-pointer ${
                        isDark
                          ? 'bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border-indigo-500/30'
                          : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-600 border-indigo-200'
                      }`}
                      title={t('user.services.showQr')}
                    >
                      <QrCode className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
