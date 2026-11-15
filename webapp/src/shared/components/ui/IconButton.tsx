import React, { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useHaptic } from '@/shared/hooks/useHaptic.js';

export type IconButtonTone = 'neutral' | 'brand' | 'danger';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  children: ReactNode;
  /** Accessible label — required for icon-only actions. */
  label: string;
  tone?: IconButtonTone;
  size?: 'sm' | 'md';
  active?: boolean;
}

const toneClasses: Record<IconButtonTone, string> = {
  neutral:
    'bg-surface-2 border-line text-ink-soft hover:text-ink hover:border-line-strong hover:bg-surface-3',
  brand: 'bg-brand-soft border-brand/25 text-brand-fg hover:bg-brand/20',
  danger: 'bg-danger-soft border-danger/25 text-danger-fg hover:bg-danger/20',
};

const sizeClasses = {
  sm: 'w-9 h-9 rounded-ctl [&>svg]:w-4 [&>svg]:h-4',
  md: 'w-11 h-11 rounded-ctl [&>svg]:w-[18px] [&>svg]:h-[18px]',
} as const;

export const IconButton: React.FC<IconButtonProps> = ({
  children,
  label,
  tone = 'neutral',
  size = 'sm',
  active = false,
  className = '',
  onClick,
  disabled,
  ...props
}) => {
  const { triggerHaptic } = useHaptic();

  return (
    <button
      type="button"
      aria-label={label}
      title={props.title ?? label}
      disabled={disabled}
      onClick={(e) => {
        if (disabled) return;
        triggerHaptic('light');
        onClick?.(e);
      }}
      className={`inline-flex items-center justify-center shrink-0 border rs-focus press cursor-pointer disabled:opacity-40 disabled:pointer-events-none ${sizeClasses[size]} ${
        active ? toneClasses.brand : toneClasses[tone]
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};
