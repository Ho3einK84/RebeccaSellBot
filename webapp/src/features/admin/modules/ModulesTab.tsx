import React from 'react';
import {
  Radio,
  Package,
  Ticket,
  CreditCard,
  HardDrive,
  Compass,
  Layers,
  Timer,
  ChevronRight,
} from 'lucide-react';
import { Card } from '@/shared/components/ui/Card.js';
import { IconTile, type TileTone } from '@/shared/components/ui/IconTile.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { SectionHeader } from '@/shared/components/ui/SectionHeader.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import type { TabType } from '@/shared/types/admin.js';

interface ModulesTabProps {
  onSwitchTab?: (tab: TabType) => void;
}

export const ModulesTab: React.FC<ModulesTabProps> = ({ onSwitchTab }) => {
  const { t } = useLanguage();

  const modules: Array<{
    id: string;
    icon: React.ComponentType<{ className?: string }>;
    tone: TileTone;
    title: string;
    desc: string;
    category: string;
    targetTab?: TabType;
  }> = [
    {
      id: 'broadcast',
      icon: Radio,
      tone: 'info',
      title: t('admin.modules.broadcast'),
      desc: t('admin.modules.broadcastSub'),
      category: t('admin.modules.categoryBroadcast'),
    },
    {
      id: 'plans',
      icon: Package,
      tone: 'ok',
      title: t('admin.modules.plans'),
      desc: t('admin.modules.plansSub'),
      category: t('admin.modules.categoryBilling'),
      targetTab: 'packages',
    },
    {
      id: 'promo',
      icon: Ticket,
      tone: 'accent',
      title: t('admin.modules.promo'),
      desc: t('admin.modules.promoSub'),
      category: t('admin.modules.categoryGrowth'),
    },
    {
      id: 'gateways',
      icon: CreditCard,
      tone: 'warn',
      title: t('admin.modules.gateways'),
      desc: t('admin.modules.gatewaysSub'),
      category: t('admin.modules.categoryPayments'),
    },
    {
      id: 'backups',
      icon: HardDrive,
      tone: 'brand',
      title: t('admin.modules.backups'),
      desc: t('admin.modules.backupsSub'),
      category: t('admin.modules.categoryDatabase'),
    },
    {
      id: 'wheel',
      icon: Compass,
      tone: 'accent',
      title: t('admin.modules.wheel'),
      desc: t('admin.modules.wheelSub'),
      category: t('admin.modules.categoryGamification'),
    },
    {
      id: 'trial',
      icon: Timer,
      tone: 'info',
      title: t('admin.modules.trial'),
      desc: t('admin.modules.trialSub'),
      category: t('admin.modules.categoryTrial'),
    },
  ];

  return (
    <div className="space-y-4 pb-6">
      <div className="space-y-1">
        <SectionHeader icon={<Layers />} title={t('admin.modules.title')} />
        <p className="text-xs m-0 text-ink-muted">{t('admin.modules.desc')}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 anim-stagger">
        {modules.map((mod) => {
          const Icon = mod.icon;
          const isLive = Boolean(mod.targetTab && onSwitchTab);
          const cardContent = (
            <Card
              padding="md"
              className={`h-full flex flex-col justify-between gap-3.5 text-start ${
                isLive
                  ? 'rs-card-interactive border-brand/35 group-hover:border-brand group-hover:bg-surface-2'
                  : 'transition-all duration-200 hover:border-line-strong hover:shadow-[var(--shadow-card-hover)]'
              }`}
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <IconTile tone={mod.tone} size="md">
                    <Icon />
                  </IconTile>

                  <Badge variant={isLive ? 'success' : 'neutral'} size="xs">
                    {mod.category}
                  </Badge>
                </div>

                <div className="space-y-1">
                  <h3 className="text-sm font-semibold m-0 text-ink">{mod.title}</h3>
                  <p className="text-xs m-0 leading-relaxed text-ink-muted">{mod.desc}</p>
                </div>
              </div>

              <div className="pt-2.5 border-t border-line flex items-center justify-between text-[11px]">
                {isLive ? (
                  <>
                    <span className="inline-flex items-center gap-1.5 font-medium text-ok-fg">
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-ok shrink-0"
                        aria-hidden="true"
                      />
                      <span>{t('admin.modules.tagActive')}</span>
                    </span>
                    <span className="inline-flex items-center gap-1 font-semibold text-brand-fg">
                      <span>{t('admin.modules.openModule')}</span>
                      <ChevronRight className="w-3.5 h-3.5 rtl:rotate-180" />
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-ink-muted">{t('admin.modules.corePlanned')}</span>
                    <span className="inline-flex items-center gap-1.5 font-medium text-brand-fg">
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-brand shrink-0"
                        aria-hidden="true"
                      />
                      <span>{t('admin.modules.tagComingSoon')}</span>
                    </span>
                  </>
                )}
              </div>
            </Card>
          );

          if (isLive && mod.targetTab && onSwitchTab) {
            return (
              <button
                key={mod.id}
                type="button"
                onClick={() => onSwitchTab(mod.targetTab!)}
                className="group press rs-focus cursor-pointer text-start w-full h-full rounded-card"
              >
                {cardContent}
              </button>
            );
          }

          return <React.Fragment key={mod.id}>{cardContent}</React.Fragment>;
        })}
      </div>
    </div>
  );
};
