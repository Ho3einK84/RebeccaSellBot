import React from 'react';
import {
  Radio,
  Ticket,
  CreditCard,
  HardDrive,
  Compass,
  Settings2,
  Timer,
  ChevronRight,
  Bell,
  Flame,
  Puzzle,
  Sliders,
  FileText,
  ShieldCheck,
  ExternalLink,
} from 'lucide-react';
import { Card } from '@/shared/components/ui/Card.js';
import { IconTile, type TileTone } from '@/shared/components/ui/IconTile.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { SectionHeader } from '@/shared/components/ui/SectionHeader.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { openTelegramLinkAndMinimize } from '@/shared/lib/telegramNavigation.js';
import type { TabType } from '@/shared/types/admin.js';

interface ModulesTabProps {
  botUsername?: string;
  onSwitchTab?: (tab: TabType) => void;
  onOpenBankCards?: () => void;
  onOpenReceiptSettings?: () => void;
}

interface ActiveToolItem {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: TileTone;
  title: string;
  desc: string;
  onOpen?: () => void;
}

interface ComingSoonModuleItem {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: TileTone;
  title: string;
  desc: string;
  deepLink: string;
}

export const ModulesTab: React.FC<ModulesTabProps> = ({
  botUsername,
  onOpenBankCards,
  onOpenReceiptSettings,
}) => {
  const { t } = useLanguage();
  const { triggerHaptic } = useHaptic();

  const cleanBotUsername = botUsername?.trim().replace(/^@+/u, '') || '';

  const openBotDeepLink = (payload: string) => {
    if (!cleanBotUsername) return;
    triggerHaptic('selection');
    openTelegramLinkAndMinimize(`https://t.me/${cleanBotUsername}?start=${payload}`);
  };

  const activeTools: ActiveToolItem[] = [
    {
      id: 'gateways',
      icon: CreditCard,
      tone: 'warn',
      title: t('admin.modules.gateways'),
      desc: t('admin.modules.gatewaysSub'),
      onOpen: onOpenBankCards,
    },
    {
      id: 'receipt-notify',
      icon: Bell,
      tone: 'brand',
      title: t('admin.modules.receiptNotify'),
      desc: t('admin.modules.receiptNotifySub'),
      onOpen: onOpenReceiptSettings,
    },
  ];

  const comingSoonGroups: Array<{
    id: string;
    label: string;
    items: ComingSoonModuleItem[];
  }> = [
    {
      id: 'sales-growth',
      label: t('admin.modules.groupSalesGrowth'),
      items: [
        {
          id: 'promo',
          icon: Ticket,
          tone: 'accent',
          title: t('admin.modules.promo'),
          desc: t('admin.modules.promoSub'),
          deepLink: 'adm_promos',
        },
        {
          id: 'discounts',
          icon: Flame,
          tone: 'warn',
          title: t('admin.modules.discounts'),
          desc: t('admin.modules.discountsSub'),
          deepLink: 'adm_discounts',
        },
        {
          id: 'trial',
          icon: Timer,
          tone: 'info',
          title: t('admin.modules.trial'),
          desc: t('admin.modules.trialSub'),
          deepLink: 'adm_trial',
        },
        {
          id: 'wheel',
          icon: Compass,
          tone: 'accent',
          title: t('admin.modules.wheel'),
          desc: t('admin.modules.wheelSub'),
          deepLink: 'adm_growth',
        },
      ],
    },
    {
      id: 'messaging',
      label: t('admin.modules.groupMessaging'),
      items: [
        {
          id: 'broadcast',
          icon: Radio,
          tone: 'info',
          title: t('admin.modules.broadcast'),
          desc: t('admin.modules.broadcastSub'),
          deepLink: 'adm_broadcast',
        },
      ],
    },
    {
      id: 'system',
      label: t('admin.modules.groupSystem'),
      items: [
        {
          id: 'orphans',
          icon: Puzzle,
          tone: 'warn',
          title: t('admin.modules.orphans'),
          desc: t('admin.modules.orphansSub'),
          deepLink: 'adm_orphans',
        },
        {
          id: 'general-settings',
          icon: Sliders,
          tone: 'brand',
          title: t('admin.modules.generalSettings'),
          desc: t('admin.modules.generalSettingsSub'),
          deepLink: 'adm_settings',
        },
        {
          id: 'backups',
          icon: HardDrive,
          tone: 'brand',
          title: t('admin.modules.backups'),
          desc: t('admin.modules.backupsSub'),
          deepLink: 'adm_backup',
        },
        {
          id: 'bot-texts',
          icon: FileText,
          tone: 'neutral',
          title: t('admin.modules.botTexts'),
          desc: t('admin.modules.botTextsSub'),
          deepLink: 'adm_texts',
        },
        {
          id: 'admins-support',
          icon: ShieldCheck,
          tone: 'ok',
          title: t('admin.modules.adminsSupport'),
          desc: t('admin.modules.adminsSupportSub'),
          deepLink: 'adm_admins',
        },
      ],
    },
  ];

  return (
    <div className="space-y-6 pb-6">
      <div className="space-y-1">
        <SectionHeader icon={<Settings2 />} title={t('admin.modules.title')} />
        <p className="text-xs m-0 text-ink-muted leading-relaxed">{t('admin.modules.desc')}</p>
      </div>

      {/* Zone 1: Live WebApp Tools */}
      <div className="space-y-2.5">
        <h3 className="text-xs font-semibold text-ink-soft m-0">
          {t('admin.modules.sectionActiveTitle')}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {activeTools.map((tool) => {
            const Icon = tool.icon;
            const inner = (
              <Card
                padding="md"
                className="h-full flex items-center gap-3 text-start rs-card-interactive border-brand/25 hover:border-brand hover:bg-surface-2"
              >
                <IconTile tone={tool.tone} size="md">
                  <Icon />
                </IconTile>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-ink truncate">{tool.title}</span>
                    <Badge variant="success" size="xs" dot>
                      {t('admin.modules.tagActive')}
                    </Badge>
                  </div>
                  <p className="text-xs text-ink-muted m-0 leading-relaxed">{tool.desc}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-ink-muted rtl:rotate-180 shrink-0" />
              </Card>
            );

            return tool.onOpen ? (
              <button
                key={tool.id}
                type="button"
                onClick={tool.onOpen}
                className="group press rs-focus cursor-pointer text-start w-full rounded-card"
              >
                {inner}
              </button>
            ) : (
              <React.Fragment key={tool.id}>{inner}</React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Zone 2: Coming Soon in WebApp (Grouped identically to Telegram Admin + Direct Bot Deep-Link) */}
      <div className="space-y-4">
        <h3 className="text-xs font-semibold text-ink-soft m-0">
          {t('admin.modules.sectionComingSoonTitle')}
        </h3>

        {comingSoonGroups.map((group) => (
          <div key={group.id} className="space-y-2">
            <div className="text-[11px] font-semibold text-ink-muted px-0.5">{group.label}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {group.items.map((mod) => {
                const Icon = mod.icon;
                const canDeepLink = Boolean(cleanBotUsername);
                const content = (
                  <Card
                    padding="md"
                    className={`h-full flex flex-col justify-between gap-3 text-start ${
                      canDeepLink
                        ? 'rs-card-interactive hover:border-brand/40 hover:bg-surface-2'
                        : 'border-line bg-surface'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <IconTile tone={mod.tone} size="sm">
                        <Icon />
                      </IconTile>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="text-xs sm:text-sm font-semibold m-0 text-ink truncate">
                            {mod.title}
                          </h4>
                          <Badge variant="neutral" size="xs" className="shrink-0">
                            {t('admin.modules.tagComingSoon')}
                          </Badge>
                        </div>
                        <p className="text-[11px] m-0 leading-relaxed text-ink-muted">{mod.desc}</p>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-line flex items-center justify-between text-[11px]">
                      <span className="text-ink-muted">{t('admin.modules.corePlanned')}</span>
                      {canDeepLink ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-brand-fg">
                          <span>{t('admin.modules.openInBot')}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </span>
                      ) : null}
                    </div>
                  </Card>
                );

                if (canDeepLink) {
                  return (
                    <button
                      key={mod.id}
                      type="button"
                      onClick={() => openBotDeepLink(mod.deepLink)}
                      className="group press rs-focus cursor-pointer text-start w-full h-full rounded-card"
                    >
                      {content}
                    </button>
                  );
                }

                return <React.Fragment key={mod.id}>{content}</React.Fragment>;
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
