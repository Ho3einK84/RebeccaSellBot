import React from 'react';
import { Zap, Activity, QrCode, Wallet, Bot } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';

export const FeatureGrid: React.FC = () => {
  const { t } = useLanguage();

  const features = [
    {
      icon: Zap,
      title: t('user.featurePurchaseTitle'),
      desc: t('user.featurePurchaseDesc'),
    },
    {
      icon: Activity,
      title: t('user.featureTrafficTitle'),
      desc: t('user.featureTrafficDesc'),
    },
    {
      icon: QrCode,
      title: t('user.featureConfigsTitle'),
      desc: t('user.featureConfigsDesc'),
    },
    {
      icon: Wallet,
      title: t('user.featureWalletTitle'),
      desc: t('user.featureWalletDesc'),
    },
  ];

  return (
    <>
      {/* Feature Roadmap List */}
      <section className="w-full mb-4 cs-fade-in-delay-3">
        <div className="flex items-center justify-between mb-2.5 px-0.5">
          <h3 className={`text-[11px] font-bold uppercase tracking-wider text-ink-muted`}>
            {t('user.upcomingFeaturesTitle')}
          </h3>
          <span className={`text-[10px] font-medium text-ink-muted`}>
            {t('user.inDevelopmentStatus')}
          </span>
        </div>

        <div className="flex flex-col gap-2">
          {features.map((feat, i) => {
            const Icon = feat.icon;
            return (
              <div
                key={i}
                className={`rounded-xl p-3 border transition-all flex items-center gap-3 bg-surface/[0.02] border-line/[0.06] hover:border-line/[0.12] shadow-2xs`}
              >
                <div
                  className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 transition-transform bg-surface/[0.05] border-line/10 text-ink-soft`}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0 text-start">
                  <h4 className={`text-[13px] font-semibold mb-0.5 leading-tight text-ink-soft`}>
                    {feat.title}
                  </h4>
                  <p className={`text-[11px] leading-snug m-0 text-ink-muted`}>{feat.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Notice: Services ready in bot */}
      <section
        className={`w-full rounded-xl p-3.5 mb-5 border flex items-start gap-3 text-start cs-fade-in-delay-3 transition-colors bg-ok/[0.04] border-ok/15`}
      >
        <div
          className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 mt-0.5 bg-ok/10 border-ok/20 text-ok`}
        >
          <Bot className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className={`text-xs font-semibold mb-0.5 text-ok`}>
            {t('user.currentServicesReadyTitle')}
          </h4>
          <p className={`text-[11px] leading-relaxed m-0 text-ink-soft`}>
            {t('user.currentServicesReadyDesc')}
          </p>
        </div>
      </section>
    </>
  );
};
