import { useTheme } from './ThemeContext.js';

export function useThemeTokens() {
  const { isDark, theme, toggleTheme, setTheme } = useTheme();

  const cardClass = isDark
    ? 'bg-white/[0.03] border-white/[0.08] text-slate-100 shadow-xl shadow-black/20'
    : 'bg-white border-slate-200/90 text-slate-900 shadow-2xs';

  const subCardClass = isDark
    ? 'bg-white/[0.02] border-white/[0.06] text-slate-200'
    : 'bg-slate-50/90 border-slate-200/80 text-slate-800';

  const inputClass = isDark
    ? 'bg-white/[0.04] border-white/10 text-white placeholder:text-zinc-500 focus:border-indigo-400'
    : 'bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-indigo-600';

  const modalBoxClass = isDark
    ? 'bg-[#0f1118] border-white/10 text-slate-100 shadow-2xl'
    : 'bg-white border-slate-200 text-slate-900 shadow-2xl';

  const textPrimary = isDark ? 'text-white' : 'text-slate-900';
  const textSecondary = isDark ? 'text-zinc-400' : 'text-slate-600';
  const textMuted = isDark ? 'text-zinc-500' : 'text-slate-400';

  return {
    isDark,
    theme,
    toggleTheme,
    setTheme,
    cardClass,
    subCardClass,
    inputClass,
    modalBoxClass,
    textPrimary,
    textSecondary,
    textMuted,
  };
}
