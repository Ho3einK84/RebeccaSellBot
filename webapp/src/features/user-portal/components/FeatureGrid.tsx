import React from 'react';
import { Zap, Activity, QrCode, Wallet, Bot } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';

export const FeatureGrid: React.FC = () => {
  const { t } = useLanguage();
  const { isDark } = useThemeTokens();

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
          <h3
            className={`text-[11px] font-bold uppercase tracking-wider ${
              isDark ? 'text-zinc-400' : 'text-slate-500'
            }`}
          >
            {t('user.upcomingFeaturesTitle')}
          </h3>
          <span
            className={`text-[10px] font-medium ${isDark ? 'text-zinc-500' : 'text-slate-400'}`}
          >
            {t('user.inDevelopmentStatus')}
          </span>
        </div>

        <div className="flex flex-col gap-2">
          {features.map((feat, i) => {
            const Icon = feat.icon;
            return (
              <div
                key={i}
                className={`rounded-xl p-3 border transition-all flex items-center gap-3 ${
                  isDark
                    ? 'bg-white/[0.02] border-white/[0.06] hover:border-white/[0.12]'
                    : 'bg-white border-slate-200/80 hover:border-slate-300 shadow-2xs'
                }`}
              >
                <div
                  className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 transition-transform ${
                    isDark
                      ? 'bg-white/[0.05] border-white/10 text-zinc-300'
                      : 'bg-slate-100 border-slate-200 text-slate-700'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0 text-start">
                  <h4
                    className={`text-[13px] font-semibold mb-0.5 leading-tight ${
                      isDark ? 'text-zinc-200' : 'text-slate-900'
                    }`}
                  >
                    {feat.title}
                  </h4>
                  <p
                    className={`text-[11px] leading-snug m-0 ${
                      isDark ? 'text-zinc-400' : 'text-slate-500'
                    }`}
                  >
                    {feat.desc}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Notice: Services ready in bot */}
      <section
        className={`w-full rounded-xl p-3.5 mb-5 border flex items-start gap-3 text-start cs-fade-in-delay-3 transition-colors ${
          isDark
            ? 'bg-emerald-500/[0.04] border-emerald-500/15'
            : 'bg-emerald-50/70 border-emerald-200'
        }`}
      >
        <div
          className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 mt-0.5 ${
            isDark
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
              : 'bg-emerald-100/70 border-emerald-300 text-emerald-700'
          }`}
        >
          <Bot className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h4
            className={`text-xs font-semibold mb-0.5 ${
              isDark ? 'text-emerald-300' : 'text-emerald-900'
            }`}
          >
            {t('user.currentServicesReadyTitle')}
          </h4>
          <p
            className={`text-[11px] leading-relaxed m-0 ${
              isDark ? 'text-zinc-300' : 'text-emerald-800/90'
            }`}
          >
            {t('user.currentServicesReadyDesc')}
          </p>
        </div>
      </section>
    </>
  );
};
