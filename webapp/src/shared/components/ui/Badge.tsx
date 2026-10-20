import React, { type HTMLAttributes } from 'react';

export type BadgeVariant =
  | 'neutral'
  | 'success'
  | 'warning'
  | 'error'
  | 'primary'
  | 'info'
  // aliases kept for backwards compatibility with older call sites
  | 'secondary'
  | 'outline';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: 'xs' | 'sm' | 'md';
  dot?: boolean;
  pulse?: boolean;
}

const sizeClasses = {
  xs: 'text-[10px] px-2 h-5 gap-1',
  sm: 'text-[11px] px-2.5 h-6 gap-1.5',
  md: 'text-xs px-3 h-7 gap-1.5',
} as const;

const variantClasses: Record<BadgeVariant, string> = {
  neutral: 'bg-surface-2 border-line text-ink-soft',
  secondary: 'bg-surface-2 border-line text-ink-soft',
  outline: 'bg-transparent border-line-strong text-ink-soft',
  success: 'bg-ok-soft border-ok/30 text-ok',
  warning: 'bg-warn-soft border-warn/30 text-warn',
  error: 'bg-danger-soft border-danger/30 text-danger',
  primary: 'bg-brand-soft border-brand/30 text-brand',
  info: 'bg-info-soft border-info/30 text-info',
};

const dotColor: Record<BadgeVariant, string> = {
  neutral: 'bg-ink-muted',
  secondary: 'bg-ink-muted',
  outline: 'bg-ink-muted',
  success: 'bg-ok',
  warning: 'bg-warn',
  error: 'bg-danger',
  primary: 'bg-brand',
  info: 'bg-info',
};

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'neutral',
  size = 'sm',
  dot = false,
  pulse = false,
  className = '',
  ...props
}) => (
  <span
    className={`inline-flex items-center rounded-full font-medium tracking-tight border select-none shrink-0 whitespace-nowrap ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
    {...props}
  >
    {dot && (
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor[variant]} ${pulse ? 'status-pulse' : ''}`}
      />
    )}
    {children}
  </span>
);
