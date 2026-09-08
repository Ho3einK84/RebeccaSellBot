import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import type { SupportedLocale, NestedTranslationKey, TranslationSchema } from './types.js';
import { fa } from './locales/fa.js';
import { en } from './locales/en.js';
import { api } from '@/shared/lib/api.js';

const locales: Record<SupportedLocale, TranslationSchema> = { fa, en };

function getNestedValue(obj: unknown, path: string): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof current === 'string' ? current : undefined;
}

export interface LanguageContextType {
  locale: SupportedLocale;
  isRtl: boolean;
  languageSelectionEnabled: boolean;
  t: (key: NestedTranslationKey, params?: Record<string, string | number>) => string;
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
  const isRtl = locale === 'fa';

  // Sync locale state if initialLocale changes
  useEffect(() => {
    if (initialLocale) {
      setLocaleState(initialLocale);
    }
  }, [initialLocale]);

  // Sync html dir and lang attributes when locale changes
  useEffect(() => {
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
    document.documentElement.lang = locale;
  }, [locale, isRtl]);

  const t = (key: NestedTranslationKey, params?: Record<string, string | number>): string => {
    const currentDict = locales[locale] || locales.fa;
    let text = getNestedValue(currentDict, key) ?? getNestedValue(locales.fa, key) ?? key;

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

    const previousLocale = locale;
    // Optimistic update
    setLocaleState(newLocale);

    const ok = await api.updateUserLocale(newLocale);
    if (!ok) {
      // Revert if API failed
      setLocaleState(previousLocale);
      return false;
    }
    return true;
  };

  return (
    <LanguageContext.Provider
      value={{
        locale,
        isRtl,
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
