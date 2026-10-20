import React from 'react';
import {
  Radio,
  Package,
  Ticket,
  CreditCard,
  HardDrive,
  Sparkles,
  Layers,
  Timer,
} from 'lucide-react';
import { Card } from '@/shared/components/ui/Card.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';

export const ModulesTab: React.FC = () => {
  const { t } = useLanguage();
  const { textPrimary, textSecondary, textMuted } = useThemeTokens();

  const modules = [
    {
      id: 'broadcast',
      icon: Radio,
      title: t('admin.modules.broadcast'),
      desc: t('admin.modules.broadcastSub'),
      category: t('admin.modules.categoryBroadcast'),
    },
    {
      id: 'plans',
      icon: Package,
      title: t('admin.modules.plans'),
      desc: t('admin.modules.plansSub'),
      category: t('admin.modules.categoryBilling'),
    },
    {
      id: 'promo',
      icon: Ticket,
      title: t('admin.modules.promo'),
      desc: t('admin.modules.promoSub'),
      category: t('admin.modules.categoryGrowth'),
    },
    {
      id: 'gateways',
      icon: CreditCard,
      title: t('admin.modules.gateways'),
      desc: t('admin.modules.gatewaysSub'),
      category: t('admin.modules.categoryPayments'),
    },
    {
      id: 'backups',
      icon: HardDrive,
      title: t('admin.modules.backups'),
      desc: t('admin.modules.backupsSub'),
      category: t('admin.modules.categoryDatabase'),
    },
    {
      id: 'wheel',
      icon: Sparkles,
      title: t('admin.modules.wheel'),
      desc: t('admin.modules.wheelSub'),
      category: t('admin.modules.categoryGamification'),
    },
    {
      id: 'trial',
      icon: Timer,
      title: t('admin.modules.trial'),
      desc: t('admin.modules.trialSub'),
      category: t('admin.modules.categoryTrial'),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Header & Context */}
      <div className="space-y-1">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border bg-brand/10 border-brand/20 text-brand shadow-xs`}
          >
            <Layers className="w-4 h-4" />
          </div>
          <h2 className={`text-base font-bold m-0 tracking-tight truncate ${textPrimary}`}>
            {t('admin.modules.title')}
          </h2>
        </div>
        <p className={`text-xs m-0 pt-0.5 ${textSecondary}`}>{t('admin.modules.desc')}</p>
      </div>

      {/* Modules Grid - Clean, Focused, Non-Generic Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {modules.map((mod) => {
          const Icon = mod.icon;
          return (
            <Card
              key={mod.id}
              className="p-4 sm:p-5 space-y-3 relative transition-all duration-150 hover:border-line-strong group"
            >
              {/* Top Row: Icon + Category Badge */}
              <div className="flex items-center justify-between gap-2">
                <div
                  className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 transition-colors bg-surface/[0.04] border-line/10 text-brand group-hover:border-brand/40 group-hover:bg-brand/10`}
                >
                  <Icon className="w-4 h-4" />
                </div>

                <span
                  className={`px-2 py-0.5 rounded-md border text-[10px] font-medium tnum bg-surface/[0.02] border-line/[0.06] text-ink-muted`}
                >
                  {mod.category}
                </span>
              </div>

              {/* Title & Description */}
              <div className="space-y-1">
                <h3 className={`text-sm font-bold m-0 tracking-tight ${textPrimary}`}>
                  {mod.title}
                </h3>
                <p className={`text-xs m-0 leading-relaxed ${textSecondary}`}>{mod.desc}</p>
              </div>

              {/* Bottom Minimal Planned Release Indicator */}
              <div className="pt-2 border-t border-line flex items-center justify-between text-[11px]">
                <span className={`text-[10px] ${textMuted}`}>{t('admin.modules.corePlanned')}</span>
                <span
                  className={`inline-flex items-center gap-1 text-[10px] font-medium text-brand/80`}
                >
                  <span className="w-1 h-1 rounded-full bg-brand/60 shrink-0" />
                  <span>{t('admin.modules.tagComingSoon')}</span>
                </span>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
};
