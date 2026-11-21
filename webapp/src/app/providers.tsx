import React, { type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './queryClient.js';
import { ThemeProvider } from '@/shared/theme/ThemeContext.js';
import { LanguageProvider, useLanguage } from '@/shared/i18n/LanguageContext.js';
import { ErrorBoundary } from '@/shared/components/layout/ErrorBoundary.js';
import { ToastProvider } from '@/shared/components/ui/Toast.js';
import type { SupportedLocale } from '@/shared/i18n/types.js';

interface ProvidersProps {
  children: ReactNode;
  initialLocale?: SupportedLocale;
  languageSelectionEnabled?: boolean;
}

const LocalizedToastBridge: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { t } = useLanguage();
  return <ToastProvider dismissLabel={t('common.close')}>{children}</ToastProvider>;
};

export const Providers: React.FC<ProvidersProps> = ({
  children,
  initialLocale = 'fa',
  languageSelectionEnabled = true,
}) => {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <LanguageProvider
            initialLocale={initialLocale}
            languageSelectionEnabled={languageSelectionEnabled}
          >
            <LocalizedToastBridge>{children}</LocalizedToastBridge>
          </LanguageProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};
