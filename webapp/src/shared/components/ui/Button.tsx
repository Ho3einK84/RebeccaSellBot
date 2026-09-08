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
    xs: 'btn-xs text-[11px] px-2.5 h-7',
    sm: 'btn-sm text-xs px-3.5 h-8',
    md: 'btn-md text-sm px-4 h-10',
    lg: 'btn-lg text-base px-5 h-12',
  }[size];

  const variantClasses: Record<ButtonVariant, string> = {
    primary:
      'bg-indigo-600 hover:bg-indigo-700 text-white border-transparent shadow-md shadow-indigo-600/20 active:scale-95',
    secondary:
      'bg-white/[0.04] dark:bg-white/[0.06] hover:bg-white/[0.08] dark:hover:bg-white/10 text-slate-700 dark:text-zinc-200 border-slate-200 dark:border-white/10 active:scale-95',
    outline:
      'border-slate-300 dark:border-white/15 bg-transparent hover:bg-slate-100 dark:hover:bg-white/5 text-slate-800 dark:text-zinc-200 active:scale-95',
    ghost:
      'bg-transparent hover:bg-slate-100 dark:hover:bg-white/5 text-slate-600 dark:text-zinc-400 border-transparent active:scale-95',
    danger:
      'bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-500/20 active:scale-95',
    success:
      'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/20 active:scale-95',
  };

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled || loading) return;
    if (haptic) triggerHaptic(haptic);
    onClick?.(e);
  };

  return (
    <button
      className={`btn font-medium rounded-xl inline-flex items-center justify-center gap-2 cursor-pointer transition-all ${sizeClasses} ${variantClasses[variant]} ${className}`}
      disabled={disabled || loading}
      onClick={handleClick}
      {...props}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin text-current" /> : null}
      {children}
    </button>
  );
};
