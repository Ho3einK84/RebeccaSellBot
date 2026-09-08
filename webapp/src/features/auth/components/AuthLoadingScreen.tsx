import React from 'react';
import { Loader2 } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';

export const AuthLoadingScreen: React.FC = () => {
  const { t } = useLanguage();

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="glass-panel p-8 max-w-sm w-full text-center flex flex-col items-center gap-4">
        <Loader2 className="w-10 h-10 text-indigo-400 animate-spin" />
        <p className="text-sm text-slate-300 font-medium">{t('auth.connecting')}</p>
      </div>
    </div>
  );
};
