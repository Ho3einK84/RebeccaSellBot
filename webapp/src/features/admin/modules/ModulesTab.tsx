import React from 'react';
import { Radio, Package, Ticket, CreditCard, HardDrive, Sparkles, Layers } from 'lucide-react';
import { Card } from '@/shared/components/ui/Card.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';

export const ModulesTab: React.FC = () => {
  const { t } = useLanguage();
  const { isDark, textPrimary, textSecondary, textMuted } = useThemeTokens();

  const modules = [
    {
      icon: Radio,
      title: t('admin.modules.broadcast'),
      desc: t('admin.modules.broadcastSub'),
      category: 'Broadcast',
    },
    {
      icon: Package,
      title: t('admin.modules.plans'),
      desc: t('admin.modules.plansSub'),
      category: 'Billing',
    },
    {
      icon: Ticket,
      title: t('admin.modules.promo'),
      desc: t('admin.modules.promoSub'),
      category: 'Growth',
    },
    {
      icon: CreditCard,
      title: t('admin.modules.gateways'),
      desc: t('admin.modules.gatewaysSub'),
      category: 'Payments',
    },
    {
      icon: HardDrive,
      title: t('admin.modules.backups'),
      desc: t('admin.modules.backupsSub'),
      category: 'Database',
    },
    {
      icon: Sparkles,
      title: t('admin.modules.wheel'),
      desc: t('admin.modules.wheelSub'),
      category: 'Gamification',
    },
  ];

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="space-y-1">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${
              isDark
                ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400 shadow-xs'
                : 'bg-indigo-50 border-indigo-200 text-indigo-600 shadow-xs'
            }`}
          >
            <Layers className="w-4 h-4" />
          </div>
          <h2 className={`text-base font-bold m-0 tracking-tight truncate ${textPrimary}`}>
            {t('admin.modules.title')}
          </h2>
        </div>
        <p className={`text-xs m-0 pt-0.5 ${textSecondary}`}>{t('admin.modules.desc')}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {modules.map((mod, i) => {
          const Icon = mod.icon;
          return (
            <Card
              key={i}
              className="p-4 sm:p-5 space-y-3.5 relative overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-400/50 dark:hover:border-indigo-500/40 group hover:shadow-sm"
            >
              {/* Subtle ambient light orb */}
              <div
                className="absolute -top-10 -end-10 w-28 h-28 rounded-full bg-gradient-to-br from-indigo-500/10 to-violet-500/0 dark:from-indigo-500/15 blur-2xl pointer-events-none group-hover:scale-150 transition-transform duration-500"
                aria-hidden="true"
              />

              {/* Top Row: Icon + Coming Soon Badge */}
              <div className="flex items-center justify-between gap-2">
                <div
                  className={`w-11 h-11 rounded-2xl border flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105 shadow-xs ${
                    isDark
                      ? 'bg-gradient-to-br from-indigo-500/20 to-violet-500/10 border-indigo-500/25 text-indigo-400'
                      : 'bg-indigo-50 border-indigo-200/80 text-indigo-600'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                </div>

                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${
                    isDark
                      ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300'
                      : 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-xs'
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 status-pulse shrink-0" />
                  <span>{t('admin.modules.tagComingSoon')}</span>
                </span>
              </div>

              {/* Title & Description */}
              <div className="space-y-1">
                <h3 className={`text-sm font-bold m-0 tracking-tight ${textPrimary}`}>
                  {mod.title}
                </h3>
                <p className={`text-xs m-0 leading-relaxed ${textSecondary}`}>{mod.desc}</p>
              </div>

              {/* Bottom Metadata Anchor */}
              <div className="pt-2 border-t border-slate-100 dark:border-white/[0.04] flex items-center justify-between text-[11px]">
                <span
                  className={`px-2 py-0.5 rounded-md border text-[10px] font-mono ${
                    isDark
                      ? 'bg-white/[0.02] border-white/[0.06] text-zinc-400'
                      : 'bg-slate-50 border-slate-200/70 text-slate-600'
                  }`}
                >
                  {mod.category}
                </span>
                <span className={`text-[10px] ${textMuted}`}>Core Planned</span>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
};
