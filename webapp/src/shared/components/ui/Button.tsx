import React, { type ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { useHaptic } from '@/shared/hooks/useHaptic.js';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  loading?: boolean;
  haptic?: 'light' | 'medium' | 'heavy' | 'selection';
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'secondary',
  size = 'sm',
  loading = false,
  disabled = false,
  haptic = 'light',
  className = '',
  onClick,
  ...props
}) => {
  const { triggerHaptic } = useHaptic();

  const sizeClasses = {
    xs: 'btn-xs text-[11px] px-2.5 h-7 rounded-lg',
    sm: 'btn-sm text-xs px-3.5 h-8 rounded-xl',
    md: 'btn-md text-sm px-4 h-10 rounded-xl',
    lg: 'btn-lg text-base px-5 h-12 rounded-2xl',
  }[size];

  const variantClasses: Record<ButtonVariant, string> = {
    primary:
      'bg-gradient-to-b from-indigo-500 to-indigo-600 hover:from-indigo-400 hover:to-indigo-500 text-white border-indigo-400/20 shadow-[0_1px_2px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.15)] active:scale-[0.98]',
    secondary:
      'bg-white dark:bg-white/[0.05] hover:bg-slate-50 dark:hover:bg-white/[0.08] text-slate-700 dark:text-zinc-200 border-slate-200 dark:border-white/10 shadow-[0_1px_2px_rgba(0,0,0,0.03)] active:scale-[0.98]',
    outline:
      'border-slate-300 dark:border-white/15 bg-transparent hover:bg-slate-100 dark:hover:bg-white/5 text-slate-800 dark:text-zinc-200 active:scale-[0.98]',
    ghost:
      'bg-transparent hover:bg-slate-100 dark:hover:bg-white/5 text-slate-600 dark:text-zinc-400 border-transparent active:scale-[0.98]',
    danger:
      'bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-200/80 dark:border-rose-500/20 active:scale-[0.98]',
    success:
      'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-500/20 active:scale-[0.98]',
  };

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled || loading) return;
    if (haptic) triggerHaptic(haptic);
    onClick?.(e);
  };

  return (
    <button
      className={`btn font-medium inline-flex items-center justify-center gap-1.5 cursor-pointer transition-all duration-150 select-none ${sizeClasses} ${variantClasses[variant]} ${className}`}
      disabled={disabled || loading}
      onClick={handleClick}
      {...props}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin text-current" /> : null}
      {children}
    </button>
  );
};
