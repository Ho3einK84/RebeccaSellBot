import React from 'react';
import { Radio, Package, Ticket, CreditCard, HardDrive, Sparkles } from 'lucide-react';
import { Card } from '@/shared/components/ui/Card.js';
import { Badge } from '@/shared/components/ui/Badge.js';
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
      <div className="space-y-0.5">
        <h2 className={`text-base font-bold m-0 tracking-tight ${textPrimary}`}>
          {t('admin.modules.title')}
        </h2>
        <p className={`text-xs m-0 ${textSecondary}`}>{t('admin.modules.desc')}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {modules.map((mod, i) => {
          const Icon = mod.icon;
          return (
            <Card
              key={i}
              className={`p-4 sm:p-5 space-y-3 relative overflow-hidden transition-all duration-200 hover:border-indigo-400/50 dark:hover:border-indigo-500/40 group`}
            >
              <Badge
                variant="neutral"
                className="text-[10px] absolute top-3.5 end-3.5 font-mono font-medium"
              >
                {t('admin.modules.tagComingSoon')}
              </Badge>
              <div
                className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105 ${
                  isDark
                    ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
                    : 'bg-indigo-50 border-indigo-200 text-indigo-700'
                }`}
              >
                <Icon className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className={`text-sm font-bold m-0 tracking-tight ${textPrimary}`}>
                  {mod.title}
                </h3>
                <p className={`text-xs m-0 leading-relaxed ${textSecondary}`}>{mod.desc}</p>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
};
