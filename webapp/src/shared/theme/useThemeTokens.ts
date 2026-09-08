import { useTheme } from './ThemeContext.js';

export function useThemeTokens() {
  const { isDark, theme, toggleTheme, setTheme } = useTheme();

  const cardClass = isDark
    ? 'bg-[#12141c]/80 border-white/[0.08] text-slate-100 shadow-[0_4px_24px_-4px_rgba(0,0,0,0.5)] backdrop-blur-md'
    : 'bg-white border-slate-200/80 text-slate-900 shadow-[0_1px_3px_0_rgba(0,0,0,0.04),0_1px_2px_-1px_rgba(0,0,0,0.04)]';

  const subCardClass = isDark
    ? 'bg-white/[0.025] border-white/[0.06] text-slate-200'
    : 'bg-slate-50/80 border-slate-200/70 text-slate-800';

  const inputClass = isDark
    ? 'bg-white/[0.04] border-white/10 text-white placeholder:text-zinc-500 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20'
    : 'bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/10';

  const modalBoxClass = isDark
    ? 'bg-[#0f1118]/95 border-white/[0.08] text-slate-100 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.8)] backdrop-blur-xl'
    : 'bg-white border-slate-200/80 text-slate-900 shadow-2xl';

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
