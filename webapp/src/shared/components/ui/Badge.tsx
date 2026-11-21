import React, { type HTMLAttributes } from 'react';

export type BadgeVariant =
  | 'neutral'
  | 'success'
  | 'warning'
  | 'error'
  | 'primary'
  | 'accent'
  | 'info'
  // aliases kept for compatibility
  | 'secondary'
  | 'outline';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: 'xs' | 'sm' | 'md';
  dot?: boolean;
  pulse?: boolean;
}

const sizeClasses = {
  xs: 'text-[11px] px-2 h-5 gap-1.5',
  sm: 'text-[11px] px-2.5 h-6 gap-1.5',
  md: 'text-xs px-3 h-7 gap-1.5',
} as const;

const variantClasses: Record<BadgeVariant, string> = {
  neutral: 'bg-surface-2 border-line text-ink-soft',
  success: 'bg-ok-soft border-ok/25 text-ok-fg',
  warning: 'bg-warn-soft border-warn/25 text-warn-fg',
  error: 'bg-danger-soft border-danger/25 text-danger-fg',
  primary: 'bg-brand-soft border-brand/25 text-brand-fg',
  accent: 'bg-accent-soft border-accent/25 text-accent-fg',
  info: 'bg-info-soft border-info/25 text-info-fg',
  secondary: 'bg-surface-2 border-line-strong text-ink-soft',
  outline: 'bg-transparent border-line-strong text-ink-soft',
};

const dotClasses: Record<BadgeVariant, string> = {
  neutral: 'bg-ink-muted',
  success: 'bg-ok ring-2 ring-ok/20',
  warning: 'bg-warn ring-2 ring-warn/20',
  error: 'bg-danger ring-2 ring-danger/20',
  primary: 'bg-brand-fg ring-2 ring-brand/20',
  accent: 'bg-accent ring-2 ring-accent/20',
  info: 'bg-info ring-2 ring-info/20',
  secondary: 'bg-ink-muted',
  outline: 'bg-ink-muted',
};

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'neutral',
  size = 'sm',
  dot = false,
  pulse: _pulse = false,
  className = '',
  ...props
}) => (
  <span
    className={`inline-flex items-center justify-center rounded-full border font-medium whitespace-nowrap leading-none ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
    {...props}
  >
    {dot ? (
      <span
        aria-hidden="true"
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClasses[variant]}`}
      />
    ) : null}
    {children}
  </span>
);
