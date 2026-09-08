import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

export type ThemeMode = 'dark' | 'light';

interface ThemeContextType {
  theme: ThemeMode;
  isDark: boolean;
  toggleTheme: () => void;
  setTheme: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

const STORAGE_KEY = 'rsbot_miniapp_theme';

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    // 1. Check local storage
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'dark' || saved === 'light') {
        return saved;
      }
    } catch {
      // ignore
    }

    // 2. Check Telegram WebApp colorScheme
    const tgScheme = window.Telegram?.WebApp?.colorScheme;
    if (tgScheme === 'dark' || tgScheme === 'light') {
      return tgScheme;
    }

    // 3. Fallback to system preferences, default to dark
    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: light)').matches
    ) {
      return 'light';
    }
    return 'dark';
  });

  // Apply theme to document and sync with Telegram
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    if (theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
    }

    // Update Telegram WebApp header/background colors if supported
    const tg = window.Telegram?.WebApp;
    if (tg) {
      const bgColor = theme === 'dark' ? '#090a0f' : '#ffffff';
      if (tg.setHeaderColor) {
        tg.setHeaderColor(bgColor);
      }
      if (tg.setBackgroundColor) {
        tg.setBackgroundColor(bgColor);
      }
    }
  }, [theme]);

  // Listen to Telegram themeChanged events
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg?.onEvent) return;

    const handleTelegramThemeChange = () => {
      try {
        const manual = localStorage.getItem(STORAGE_KEY);
        if (!manual) {
          const newScheme = tg.colorScheme;
          if (newScheme === 'dark' || newScheme === 'light') {
            setThemeState(newScheme);
          }
        }
      } catch {
        // ignore
      }
    };

    tg.onEvent('themeChanged', handleTelegramThemeChange);
    return () => {
      tg.offEvent?.('themeChanged', handleTelegramThemeChange);
    };
  }, []);

  const setTheme = (mode: ThemeMode) => {
    setThemeState(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // ignore
    }
    window.Telegram?.WebApp?.HapticFeedback?.selectionChanged();
  };

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
  };

  return (
    <ThemeContext.Provider
      value={{
        theme,
        isDark: theme === 'dark',
        toggleTheme,
        setTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
