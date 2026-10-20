import React, { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useHaptic } from '@/shared/hooks/useHaptic.js';

export type IconButtonTone = 'neutral' | 'brand' | 'danger';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  children: ReactNode;
  /** Accessible label — required, these buttons are icon-only. */
  label: string;
  tone?: IconButtonTone;
  size?: 'sm' | 'md';
  active?: boolean;
}

const toneClasses: Record<IconButtonTone, string> = {
  neutral: 'bg-surface-2 border-line text-ink-soft hover:text-ink hover:border-line-strong',
  brand: 'bg-brand-soft border-brand/30 text-brand hover:bg-brand/20',
  danger: 'bg-danger-soft border-danger/30 text-danger hover:bg-danger/20',
};

/**
 * Icon-only control with a guaranteed 40/44px hit area, one border radius and
 * one active treatment — replaces the mix of circles, squircles and pills that
 * used to sit next to each other in the headers.
 */
export const IconButton: React.FC<IconButtonProps> = ({
  children,
  label,
  tone = 'neutral',
  size = 'md',
  active = false,
  className = '',
  onClick,
  ...props
}) => {
  const { triggerHaptic } = useHaptic();

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`press rs-focus inline-flex items-center justify-center shrink-0 border ${
        size === 'md' ? 'w-11 h-11 rounded-tile' : 'w-9 h-9 rounded-ctl'
      } ${toneClasses[tone]} ${
        active ? '!border-brand/50 !text-brand !bg-brand-soft' : ''
      } ${className}`}
      onClick={(e) => {
        triggerHaptic('light');
        onClick?.(e);
      }}
      {...props}
    >
      {children}
    </button>
  );
};
