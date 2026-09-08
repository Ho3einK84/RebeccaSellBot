import { useTheme } from './ThemeContext.js';

export function useThemeTokens() {
  const { isDark, theme, toggleTheme, setTheme } = useTheme();

  const cardClass = isDark
    ? 'bg-[#10121a]/85 border-white/[0.08] text-slate-100 shadow-[0_4px_24px_-2px_rgba(0,0,0,0.55),inset_0_1px_0_0_rgba(255,255,255,0.05)] backdrop-blur-md'
    : 'bg-white border-slate-200/90 text-slate-900 shadow-[0_1px_3px_0_rgba(0,0,0,0.03),0_6px_20px_-4px_rgba(0,0,0,0.04)]';

  const subCardClass = isDark
    ? 'bg-white/[0.03] border-white/[0.07] text-slate-200 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]'
    : 'bg-slate-50/90 border-slate-200/80 text-slate-800 shadow-[inset_0_1px_1px_rgba(0,0,0,0.02)]';

  const inputClass = isDark
    ? 'bg-white/[0.04] border-white/10 text-white placeholder:text-zinc-500 focus:border-indigo-400/80 focus:ring-2 focus:ring-indigo-400/20'
    : 'bg-white border-slate-200 hover:border-slate-300 text-slate-900 placeholder:text-slate-400 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/10 shadow-[0_1px_2px_rgba(0,0,0,0.02)]';

  const modalBoxClass = isDark
    ? 'bg-[#0d0f16]/95 border-white/[0.09] text-slate-100 shadow-[0_25px_60px_-12px_rgba(0,0,0,0.85),inset_0_1px_0_0_rgba(255,255,255,0.06)] backdrop-blur-xl'
    : 'bg-white border-slate-200 text-slate-900 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.12),0_4px_16px_rgba(0,0,0,0.04)]';

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
