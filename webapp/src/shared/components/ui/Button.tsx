import React, { type ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { useHaptic } from '@/shared/hooks/useHaptic.js';

export type ButtonVariant =
  'primary' | 'tonal' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  haptic?: 'light' | 'medium' | 'heavy' | 'selection';
  /** Stretch to the full width of the container. */
  block?: boolean;
}

/**
 * Token-driven control scale on 4px grid:
 * xs 32px · sm 36px · md 44px · lg 48px (`md` & `lg` meet 44px touch target minimum).
 */
const sizeClasses: Record<ButtonSize, string> = {
  xs: 'text-xs px-2.5 h-8 rounded-ctl gap-1.5',
  sm: 'text-xs px-3 h-9 rounded-ctl gap-1.5',
  md: 'text-[13px] px-4 h-11 rounded-ctl gap-2',
  lg: 'text-sm px-5 h-12 rounded-tile gap-2',
};

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-brand hover:bg-brand-hover text-brand-ink border border-transparent rs-btn-primary',
  tonal: 'bg-brand-soft hover:bg-brand/20 text-brand-fg border border-brand/25',
  secondary:
    'bg-surface-2 hover:bg-surface-3 border border-line-strong text-ink shadow-[var(--shadow-xs)]',
  outline:
    'bg-surface hover:bg-surface-2 border border-line-strong text-ink shadow-[var(--shadow-xs)]',
  ghost: 'bg-transparent hover:bg-surface-2 border border-transparent text-ink-soft hover:text-ink',
  danger: 'bg-danger-soft hover:bg-danger/20 border border-danger/25 text-danger-fg',
  success: 'bg-ok hover:bg-ok/90 border border-transparent text-white rs-btn-success',
};

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  haptic = 'light',
  block = false,
  className = '',
  onClick,
  ...props
}) => {
  const { triggerHaptic } = useHaptic();

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (loading || disabled) return;
    triggerHaptic(haptic);
    onClick?.(e);
  };

  return (
    <button
      disabled={disabled || loading}
      onClick={handleClick}
      className={`inline-flex items-center justify-center font-medium whitespace-nowrap select-none cursor-pointer transition-all duration-150 press rs-focus disabled:opacity-45 disabled:pointer-events-none ${block ? 'w-full' : ''} ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
      {...props}
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" /> : null}
      {children}
    </button>
  );
};
