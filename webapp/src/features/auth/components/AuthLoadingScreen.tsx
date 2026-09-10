import React from 'react';
import { Loader2 } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';

export const AuthLoadingScreen: React.FC = () => {
  const { t, isRtl } = useLanguage();
  const { isDark, textSecondary } = useThemeTokens();

  return (
    <div
      className="fixed inset-0 w-screen"
      style={{ height: '100dvh' }}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="flex items-center justify-center w-full h-full p-4">
        <div
          className={`p-8 max-w-sm w-full text-center flex flex-col items-center gap-4 rounded-2xl border ${
            isDark
              ? 'bg-[#10121a]/90 border-white/[0.08] backdrop-blur-xl'
              : 'bg-white border-slate-200'
          }`}
        >
          <Loader2
            className={`w-10 h-10 animate-spin ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`}
          />
          <p className={`text-sm font-medium ${textSecondary}`}>{t('auth.connecting')}</p>
        </div>
      </div>
    </div>
  );
};
