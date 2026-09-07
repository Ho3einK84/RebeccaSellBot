import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { translations, type SupportedLocale, type TranslationKey } from './translations.js';

interface LanguageContextType {
  locale: SupportedLocale;
  languageSelectionEnabled: boolean;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  setLocale: (newLocale: SupportedLocale) => Promise<boolean>;
}

const LanguageContext = createContext<LanguageContextType | null>(null);

export interface LanguageProviderProps {
  children: ReactNode;
  initialLocale?: SupportedLocale;
  languageSelectionEnabled?: boolean;
}

export const LanguageProvider: React.FC<LanguageProviderProps> = ({
  children,
  initialLocale = 'fa',
  languageSelectionEnabled = true,
}) => {
  const [locale, setLocaleState] = useState<SupportedLocale>(initialLocale);

  // Sync html dir and lang attributes when locale changes
  useEffect(() => {
    document.documentElement.dir = locale === 'fa' ? 'rtl' : 'ltr';
    document.documentElement.lang = locale;
  }, [locale]);

  const t = (key: TranslationKey, params?: Record<string, string | number>): string => {
    const dict = translations[locale] || translations.fa;
    let text = dict[key] || translations.fa[key] || key;
    if (params) {
      for (const [paramKey, val] of Object.entries(params)) {
        text = text.replaceAll(`{${paramKey}}`, String(val));
      }
    }
    return text;
  };

  const setLocale = async (newLocale: SupportedLocale): Promise<boolean> => {
    if (!languageSelectionEnabled || newLocale === locale) {
      return false;
    }

    try {
      const res = await fetch('/api/user/locale', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ locale: newLocale }),
      });

      if (!res.ok) {
        return false;
      }

      setLocaleState(newLocale);
      return true;
    } catch {
      return false;
    }
  };

  return (
    <LanguageContext.Provider
      value={{
        locale,
        languageSelectionEnabled,
        t,
        setLocale,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = (): LanguageContextType => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
