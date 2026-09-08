import React, { type HTMLAttributes } from 'react';
import { useTheme } from '@/shared/theme/ThemeContext.js';

export type BadgeVariant = 'neutral' | 'success' | 'warning' | 'error' | 'primary' | 'info';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  dot?: boolean;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'neutral',
  dot = false,
  className = '',
  ...props
}) => {
  const { isDark } = useTheme();

  const variantClasses: Record<BadgeVariant, string> = {
    neutral: isDark
      ? 'bg-white/[0.04] border-white/10 text-zinc-300'
      : 'bg-slate-100 border-slate-200 text-slate-700',
    success: isDark
      ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
      : 'bg-emerald-50 border-emerald-200 text-emerald-700',
    warning: isDark
      ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
      : 'bg-amber-50 border-amber-200 text-amber-800',
    error: isDark
      ? 'bg-rose-500/15 border-rose-500/30 text-rose-300'
      : 'bg-rose-50 border-rose-200 text-rose-700',
    primary: isDark
      ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300'
      : 'bg-indigo-50 border-indigo-200 text-indigo-700',
    info: isDark
      ? 'bg-sky-500/15 border-sky-500/30 text-sky-300'
      : 'bg-sky-50 border-sky-200 text-sky-700',
  };

  const dotColor: Record<BadgeVariant, string> = {
    neutral: isDark ? 'bg-zinc-400' : 'bg-slate-500',
    success: 'bg-emerald-500',
    warning: 'bg-amber-400',
    error: 'bg-rose-500',
    primary: 'bg-indigo-500',
    info: 'bg-sky-400',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${variantClasses[variant]} ${className}`}
      {...props}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotColor[variant]}`} />}
      {children}
    </span>
  );
};
