import React from 'react';
import { Zap, Activity, QrCode, Wallet, Bot } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { Card } from '@/shared/components/ui/Card.js';
import { IconTile, type TileTone } from '@/shared/components/ui/IconTile.js';
import { Badge } from '@/shared/components/ui/Badge.js';

export const FeatureGrid: React.FC = () => {
  const { t } = useLanguage();

  const features: Array<{
    title: string;
    desc: string;
    icon: React.ComponentType<{ className?: string }>;
    tone: TileTone;
  }> = [
    {
      title: t('user.featurePurchaseTitle'),
      desc: t('user.featurePurchaseDesc'),
      icon: Zap,
      tone: 'brand',
    },
    {
      title: t('user.featureTrafficTitle'),
      desc: t('user.featureTrafficDesc'),
      icon: Activity,
      tone: 'ok',
    },
    {
      title: t('user.featureConfigsTitle'),
      desc: t('user.featureConfigsDesc'),
      icon: QrCode,
      tone: 'info',
    },
    {
      title: t('user.featureWalletTitle'),
      desc: t('user.featureWalletDesc'),
      icon: Wallet,
      tone: 'neutral',
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-xs font-semibold text-ink-soft m-0">
          {t('user.upcomingFeaturesTitle')}
        </h3>
        <Badge variant="neutral" size="xs">
          {t('user.inDevelopmentStatus')}
        </Badge>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 anim-stagger">
        {features.map((feat) => {
          const Icon = feat.icon;
          return (
            <Card key={feat.title} padding="md" className="flex items-start gap-3">
              <IconTile tone={feat.tone} size="md">
                <Icon />
              </IconTile>
              <div className="min-w-0 flex-1 space-y-0.5">
                <h4 className="text-xs font-semibold text-ink leading-[1.4] m-0">{feat.title}</h4>
                <p className="text-xs text-ink-muted leading-relaxed m-0">{feat.desc}</p>
              </div>
            </Card>
          );
        })}
      </div>

      <Card subCard padding="md" className="flex items-start gap-3">
        <IconTile tone="ok" size="md">
          <Bot />
        </IconTile>
        <div className="min-w-0 flex-1 space-y-1">
          <h4 className="text-xs font-semibold text-ink leading-[1.4] m-0">
            {t('user.currentServicesReadyTitle')}
          </h4>
          <p className="text-xs text-ink-muted leading-relaxed m-0">
            {t('user.currentServicesReadyDesc')}
          </p>
        </div>
      </Card>
    </div>
  );
};
