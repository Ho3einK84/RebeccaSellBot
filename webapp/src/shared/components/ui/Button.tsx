import React, { type ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { useHaptic } from '@/shared/hooks/useHaptic.js';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';
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
 * Token-driven sizing scale (shared by both panels):
 * xs 32 · sm 36 · md 44 · lg 48 — `md`/`lg` meet the 44px touch target.
 */
const sizeClasses: Record<ButtonSize, string> = {
  xs: 'text-[11px] px-2.5 h-8 rounded-ctl gap-1',
  sm: 'text-xs px-3.5 h-9 rounded-ctl gap-1.5',
  md: 'text-sm px-4 h-11 rounded-ctl gap-2',
  lg: 'text-[15px] px-5 h-12 rounded-hero gap-2.5',
};

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'border border-brand/40 bg-brand text-brand-ink shadow-e1 hover:brightness-110 focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--rs-brand)_35%,transparent)]',
  secondary:
    'border border-line bg-surface-2 text-ink shadow-e1 hover:bg-surface-3 hover:border-line-strong',
  outline: 'border border-line-strong bg-transparent text-ink hover:bg-surface-2',
  ghost: 'border border-transparent bg-transparent text-ink-soft hover:bg-surface-2 hover:text-ink',
  danger: 'border border-danger/30 bg-danger-soft text-danger hover:bg-danger/20',
  success: 'border border-ok/30 bg-ok-soft text-ok hover:bg-ok/20',
};

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'secondary',
  size = 'sm',
  loading = false,
  disabled = false,
  haptic = 'light',
  block = false,
  className = '',
  onClick,
  ...props
}) => {
  const { triggerHaptic } = useHaptic();

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled || loading) return;
    if (haptic) triggerHaptic(haptic);
    onClick?.(e);
  };

  return (
    <button
      className={`press rs-focus font-medium inline-flex items-center justify-center whitespace-nowrap select-none disabled:opacity-40 disabled:pointer-events-none disabled:cursor-not-allowed ${
        block ? 'w-full' : ''
      } ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
      disabled={disabled || loading}
      onClick={handleClick}
      {...props}
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin text-current shrink-0" /> : null}
      {children}
    </button>
  );
};
