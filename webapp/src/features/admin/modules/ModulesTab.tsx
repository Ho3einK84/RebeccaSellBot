import React from 'react';
import {
  Radio,
  Ticket,
  CreditCard,
  HardDrive,
  Compass,
  Settings2,
  Timer,
  ChevronLeft,
  Bell,
  Flame,
  Puzzle,
  Sliders,
  FileText,
  ShieldCheck,
  ExternalLink,
  Zap,
  Sparkles,
  Send,
  Megaphone,
  Gift,
  Tags,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/shared/components/ui/Card.js';
import { IconTile, type TileTone } from '@/shared/components/ui/IconTile.js';
import { Badge, type BadgeVariant } from '@/shared/components/ui/Badge.js';
import { SectionHeader } from '@/shared/components/ui/SectionHeader.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { api } from '@/shared/lib/api.js';
import { queryKeys } from '@/shared/lib/queryKeys.js';
import { openTelegramLinkAndMinimize } from '@/shared/lib/telegramNavigation.js';
import type { TabType } from '@/shared/types/admin.js';

interface ModulesTabProps {
  botUsername?: string;
  onSwitchTab?: (tab: TabType) => void;
  onOpenUserGroups?: () => void;
  onOpenBankCards?: () => void;
  onOpenPaymentGateways?: () => void;
  onOpenReceiptSettings?: () => void;
  onOpenForcedJoin?: () => void;
  onOpenBulkGift?: () => void;
}

interface StatusPill {
  label: string;
  variant: BadgeVariant;
  dot?: boolean;
}

interface ActiveToolItem {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: TileTone;
  title: string;
  desc: string;
  pills: StatusPill[];
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
  onOpenUserGroups,
  onOpenBankCards,
  onOpenPaymentGateways,
  onOpenReceiptSettings,
  onOpenForcedJoin,
  onOpenBulkGift,
}) => {
  const { t } = useLanguage();
  const { formatNumber } = useFormatters();
  const { triggerHaptic } = useHaptic();

  const cleanBotUsername = botUsername?.trim().replace(/^@+/u, '') || '';

  // Non-blocking live status queries — share cache with their respective modals so opening is instant.
  const { data: bankCardsData } = useQuery({
    queryKey: queryKeys.bankCards,
    queryFn: () => api.getAdminBankCards(),
    staleTime: 60_000,
  });

  const { data: gatewaysData } = useQuery({
    queryKey: queryKeys.paymentGateways,
    queryFn: () => api.getAdminPaymentGateways(),
    staleTime: 60_000,
  });

  const { data: receiptSettingsData } = useQuery({
    queryKey: queryKeys.receiptSettings,
    queryFn: () => api.getReceiptSettings(),
    staleTime: 60_000,
  });

  const { data: forcedJoinData } = useQuery({
    queryKey: queryKeys.forcedJoin,
    queryFn: () => api.getAdminForcedJoin(),
    staleTime: 60_000,
  });

  const { data: bulkGiftData } = useQuery({
    queryKey: queryKeys.bulkGiftJobs(1),
    queryFn: () => api.getAdminBulkGiftJobs(1, 5),
    staleTime: 30_000,
  });

  const { data: userGroupsData } = useQuery({
    queryKey: queryKeys.userGroups,
    queryFn: () => api.getAdminUserGroups(),
    staleTime: 60_000,
  });

  const openBotDeepLink = (payload: string) => {
    if (!cleanBotUsername) return;
    triggerHaptic('selection');
    openTelegramLinkAndMinimize(`https://t.me/${cleanBotUsername}?start=${payload}`);
  };

  const bankCardPills: StatusPill[] = [];
  if (bankCardsData) {
    if (bankCardsData.cards.length > 0) {
      bankCardPills.push({
        label: t('admin.modules.statusActiveCards', {
          count: formatNumber(bankCardsData.activeCount),
        }),
        variant: bankCardsData.activeCount > 0 ? 'success' : 'warning',
        dot: true,
      });
    } else {
      bankCardPills.push({
        label: t('admin.modules.statusSingleCard'),
        variant: 'neutral',
        dot: true,
      });
    }
    if (bankCardsData.uniqueTopupAmountEnabled) {
      bankCardPills.push({
        label: t('admin.modules.statusUniqueAmount'),
        variant: 'info',
      });
    }
  }

  const gatewayPills: StatusPill[] = [];
  if (gatewaysData) {
    gatewayPills.push({
      label: 'ForApp',
      variant: gatewaysData.forapp.enabled ? 'success' : 'neutral',
      dot: true,
    });
    gatewayPills.push({
      label: 'NOWPayments',
      variant: gatewaysData.nowpayments.enabled ? 'success' : 'neutral',
      dot: true,
    });
    if (gatewaysData.forapp.unmatchedCount > 0) {
      gatewayPills.push({
        label: t('admin.modules.statusUnmatchedCount', {
          count: formatNumber(gatewaysData.forapp.unmatchedCount),
        }),
        variant: 'warning',
      });
    }
  }

  const receiptPills: StatusPill[] = [];
  if (receiptSettingsData) {
    receiptPills.push({
      label: receiptSettingsData.enabled
        ? t('admin.modules.statusAlertsOn')
        : t('admin.modules.statusAlertsOff'),
      variant: receiptSettingsData.enabled ? 'success' : 'neutral',
      dot: true,
    });
    receiptPills.push({
      label:
        receiptSettingsData.duplicatePolicy === 'block'
          ? t('admin.modules.statusDupBlock')
          : t('admin.modules.statusDupWarn'),
      variant: receiptSettingsData.duplicatePolicy === 'block' ? 'warning' : 'info',
    });
  }

  const forcedJoinPills: StatusPill[] = [];
  if (forcedJoinData) {
    const scopeLabel =
      forcedJoinData.scope === 'all'
        ? t('admin.modules.statusScopeAll')
        : forcedJoinData.scope === 'trial_only'
          ? t('admin.modules.statusScopeTrial')
          : forcedJoinData.scope === 'purchase_and_trial'
            ? t('admin.modules.statusScopePurchaseTrial')
            : t('admin.modules.statusScopeOff');
    forcedJoinPills.push({
      label: scopeLabel,
      variant: forcedJoinData.scope === 'off' ? 'neutral' : 'success',
      dot: true,
    });
    if (forcedJoinData.activeCount > 0) {
      forcedJoinPills.push({
        label: t('admin.modules.statusActiveChannels', {
          count: formatNumber(forcedJoinData.activeCount),
        }),
        variant: 'info',
      });
    }
  }

  const bulkGiftPills: StatusPill[] = [];
  if (bulkGiftData) {
    if (bulkGiftData.activeCount > 0) {
      bulkGiftPills.push({
        label: t('admin.modules.statusActiveCampaigns', {
          count: formatNumber(bulkGiftData.activeCount),
        }),
        variant: 'warning',
        dot: true,
      });
    } else {
      bulkGiftPills.push({
        label: t('admin.modules.statusIdle'),
        variant: 'neutral',
        dot: true,
      });
    }
  }

  const userGroupsPills: StatusPill[] = [];
  if (userGroupsData) {
    const groups = userGroupsData.groups;
    if (groups.length > 0) {
      userGroupsPills.push({
        label: t('admin.modules.statusGroupsCount', { count: formatNumber(groups.length) }),
        variant: 'success',
        dot: true,
      });
      const defaultGrp = groups.find((g) => g.isDefault);
      if (defaultGrp) {
        userGroupsPills.push({
          label: t('admin.modules.statusDefaultGroup', { name: defaultGrp.name }),
          variant: 'info',
        });
      }
      const creditCount = groups.filter((g) => g.creditLimit > 0).length;
      if (creditCount > 0) {
        userGroupsPills.push({
          label: t('admin.modules.statusCreditVipGroups', { count: formatNumber(creditCount) }),
          variant: 'warning',
        });
      }
    } else {
      userGroupsPills.push({
        label: t('admin.modules.statusNoGroups'),
        variant: 'neutral',
        dot: true,
      });
    }
  }

  const activeTools: ActiveToolItem[] = [
    {
      id: 'user-groups',
      icon: Tags,
      tone: 'accent',
      title: t('admin.modules.userGroups'),
      desc: t('admin.modules.userGroupsSub'),
      pills: userGroupsPills,
      onOpen: onOpenUserGroups,
    },
    {
      id: 'forced-join',
      icon: Megaphone,
      tone: 'brand',
      title: t('admin.modules.forcedJoin'),
      desc: t('admin.modules.forcedJoinSub'),
      pills: forcedJoinPills,
      onOpen: onOpenForcedJoin,
    },
    {
      id: 'bulk-gift',
      icon: Gift,
      tone: 'accent',
      title: t('admin.modules.bulkGift'),
      desc: t('admin.modules.bulkGiftSub'),
      pills: bulkGiftPills,
      onOpen: onOpenBulkGift,
    },
    {
      id: 'gateways',
      icon: CreditCard,
      tone: 'warn',
      title: t('admin.modules.gateways'),
      desc: t('admin.modules.gatewaysSub'),
      pills: bankCardPills,
      onOpen: onOpenBankCards,
    },
    {
      id: 'auto-gateways',
      icon: Zap,
      tone: 'ok',
      title: t('admin.modules.autoGateways'),
      desc: t('admin.modules.autoGatewaysSub'),
      pills: gatewayPills,
      onOpen: onOpenPaymentGateways,
    },
    {
      id: 'receipt-notify',
      icon: Bell,
      tone: 'brand',
      title: t('admin.modules.receiptNotify'),
      desc: t('admin.modules.receiptNotifySub'),
      pills: receiptPills,
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
    <div className="space-y-5 pb-8">
      {/* Compact Header Card */}
      <Card padding="md" className="flex items-start gap-3">
        <IconTile tone="brand" size="md">
          <Settings2 />
        </IconTile>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="text-[15px] font-bold text-ink m-0 leading-snug">
            {t('admin.modules.title')}
          </h2>
          <p className="text-xs m-0 text-ink-muted leading-relaxed">{t('admin.modules.desc')}</p>
        </div>
      </Card>

      {/* Zone 1: Live WebApp Tools */}
      <div className="space-y-2.5">
        <SectionHeader
          icon={<Sparkles className="text-ok-fg" />}
          title={t('admin.modules.sectionActiveTitle')}
          count={formatNumber(activeTools.length)}
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          {activeTools.map((tool) => {
            const Icon = tool.icon;
            const inner = (
              <Card
                padding="none"
                className="h-full p-3.5 flex flex-col justify-between gap-2.5 text-start rs-card-interactive hover:border-brand/40 hover:bg-surface-2/80"
              >
                <div className="flex items-center gap-3">
                  <IconTile tone={tool.tone} size="md">
                    <Icon />
                  </IconTile>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="text-[13.5px] font-semibold text-ink leading-snug truncate">
                      {tool.title}
                    </div>
                    <p className="text-xs text-ink-muted m-0 leading-relaxed line-clamp-2">
                      {tool.desc}
                    </p>
                  </div>
                  <ChevronLeft
                    className="w-4 h-4 text-ink-muted ltr:rotate-180 shrink-0 transition-transform duration-200 group-hover:-translate-x-0.5 ltr:group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </div>

                {tool.pills.length > 0 ? (
                  <div className="pt-2.5 border-t border-line/70 flex items-center gap-1.5 flex-wrap">
                    {tool.pills.map((pill) => (
                      <Badge key={pill.label} variant={pill.variant} size="xs" dot={pill.dot}>
                        {pill.label}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </Card>
            );

            return tool.onOpen ? (
              <button
                key={tool.id}
                type="button"
                onClick={() => {
                  triggerHaptic('selection');
                  tool.onOpen?.();
                }}
                className="group press rs-focus cursor-pointer text-start w-full h-full rounded-card"
              >
                {inner}
              </button>
            ) : (
              <React.Fragment key={tool.id}>{inner}</React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Zone 2: Bot Deep-Link Modules (Grouped Native Settings Lists) */}
      <div className="space-y-4">
        <SectionHeader icon={<Send />} title={t('admin.modules.sectionComingSoonTitle')} />

        {comingSoonGroups.map((group) => (
          <div key={group.id} className="space-y-1.5">
            <div className="flex items-center justify-between px-1">
              <span className="text-[11px] font-semibold text-ink-soft">{group.label}</span>
              <span className="text-[10px] tnum text-ink-muted">
                {formatNumber(group.items.length)}
              </span>
            </div>

            <Card padding="none" className="overflow-hidden divide-y divide-line">
              {group.items.map((mod) => {
                const Icon = mod.icon;
                const canDeepLink = Boolean(cleanBotUsername);
                const rowContent = (
                  <>
                    <IconTile tone={mod.tone} size="sm">
                      <Icon />
                    </IconTile>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="text-[13px] font-semibold text-ink leading-snug truncate">
                        {mod.title}
                      </div>
                      <p className="text-[11px] text-ink-muted m-0 leading-snug line-clamp-2">
                        {mod.desc}
                      </p>
                    </div>
                    {canDeepLink ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 border border-line px-2.5 h-6 text-[11px] font-medium text-brand-fg shrink-0 group-hover:border-brand/40 group-hover:bg-brand-soft transition-colors">
                        <span className="sm:hidden">{t('admin.modules.botBadge')}</span>
                        <span className="hidden sm:inline">{t('admin.modules.openInBot')}</span>
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </span>
                    ) : (
                      <Badge variant="neutral" size="xs" className="shrink-0">
                        {t('admin.modules.tagComingSoon')}
                      </Badge>
                    )}
                  </>
                );

                if (canDeepLink) {
                  return (
                    <button
                      key={mod.id}
                      type="button"
                      title={t('admin.modules.openInBot')}
                      aria-label={`${mod.title} — ${t('admin.modules.openInBot')}`}
                      onClick={() => openBotDeepLink(mod.deepLink)}
                      className="group w-full flex items-center gap-3 px-3.5 py-3 text-start transition-colors hover:bg-surface-2/80 active:bg-surface-2 rs-focus cursor-pointer"
                    >
                      {rowContent}
                    </button>
                  );
                }

                return (
                  <div
                    key={mod.id}
                    className="w-full flex items-center gap-3 px-3.5 py-3 text-start"
                  >
                    {rowContent}
                  </div>
                );
              })}
            </Card>
          </div>
        ))}
      </div>
    </div>
  );
};
