import React from 'react';
import { Radio, Package, Ticket, CreditCard, HardDrive, Sparkles } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';

export const ModulesTab: React.FC = () => {
  const { t } = useLanguage();
  const { isDark, textPrimary, textSecondary } = useThemeTokens();

  const modules = [
    {
      icon: Radio,
      title: t('admin.modules.broadcast'),
      desc: t('admin.modules.broadcastSub'),
    },
    {
      icon: Package,
      title: t('admin.modules.plans'),
      desc: t('admin.modules.plansSub'),
    },
    {
      icon: Ticket,
      title: t('admin.modules.promo'),
      desc: t('admin.modules.promoSub'),
    },
    {
      icon: CreditCard,
      title: t('admin.modules.gateways'),
      desc: t('admin.modules.gatewaysSub'),
    },
    {
      icon: HardDrive,
      title: t('admin.modules.backups'),
      desc: t('admin.modules.backupsSub'),
    },
    {
      icon: Sparkles,
      title: t('admin.modules.wheel'),
      desc: t('admin.modules.wheelSub'),
    },
  ];

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div>
        <h2 className={`text-base font-bold m-0 ${textPrimary}`}>{t('admin.modules.title')}</h2>
        <p className={`text-xs m-0 mt-1 ${textSecondary}`}>{t('admin.modules.desc')}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {modules.map((mod, i) => {
          const Icon = mod.icon;
          return (
            <div
              key={i}
              className={`rounded-2xl p-4 space-y-2 border-dashed border transition-all relative overflow-hidden ${
                isDark ? 'bg-white/[0.02] border-white/15' : 'bg-white border-slate-300 shadow-2xs'
              }`}
            >
              <span className="badge badge-warning badge-sm text-[10px] absolute top-3 left-3 rtl:left-auto rtl:right-3 font-medium">
                {t('admin.modules.tagComingSoon')}
              </span>
              <div
                className={`w-10 h-10 rounded-xl border flex items-center justify-center ${
                  isDark
                    ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
                    : 'bg-indigo-50 border-indigo-200 text-indigo-700'
                }`}
              >
                <Icon className="w-5 h-5" />
              </div>
              <h3 className={`text-sm font-bold m-0 ${textPrimary}`}>{mod.title}</h3>
              <p className={`text-xs m-0 ${textSecondary}`}>{mod.desc}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
};
