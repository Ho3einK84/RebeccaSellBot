import { useTheme } from './ThemeContext.js';

/**
 * Shared style tokens for the whole mini app (admin panel + user portal).
 *
 * Everything resolves through CSS custom properties declared in
 * `src/styles/app.css` (`--rs-*` → Tailwind `@theme inline`), so a single
 * definition keeps both surfaces identical in dark and light mode. Prefer
 * these class strings (or the raw utilities `bg-surface`, `text-ink`,
 * `border-line`, `rounded-card`, …) over `isDark ? … : …` ternaries.
 */
export function useThemeTokens() {
  const { isDark, theme, toggleTheme, setTheme } = useTheme();

  return {
    isDark,
    theme,
    toggleTheme,
    setTheme,

    /** Primary card surface. */
    cardClass: 'bg-surface border border-line shadow-e2 backdrop-blur-xl',
    /** Nested / secondary surface inside a card. */
    subCardClass: 'bg-surface-2 border border-line',
    /** Text inputs and selects. */
    inputClass:
      'bg-surface-2 border border-line text-ink placeholder:text-ink-muted focus:border-brand focus:ring-2 focus:ring-brand/25',
    /** Modal / sheet container. */
    modalBoxClass: 'bg-canvas border-line shadow-e3',

    textPrimary: 'text-ink',
    textSecondary: 'text-ink-soft',
    textMuted: 'text-ink-muted',

    surfaceBase: 'bg-canvas',
    borderSubtle: 'border-line',
    borderStrong: 'border-line-strong',

    /** Neutral brand-tinted icon tile used across KPIs, rows and nav rails. */
    iconTileClass: 'bg-brand-soft text-brand border border-brand/20',
    /** Brand-tinted highlight surface. */
    brandSoftClass: 'bg-brand-soft border border-brand/20 text-brand',
  };
}
