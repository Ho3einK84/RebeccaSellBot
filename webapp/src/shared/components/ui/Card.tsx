import React, { type HTMLAttributes } from 'react';

export type CardTone = 'default' | 'subtle' | 'brand' | 'danger' | 'warn';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Rendered as a nested surface inside another card (drops radius to match padding). */
  subCard?: boolean;
  interactive?: boolean;
  tone?: CardTone;
  padding?: CardPadding;
}

const paddingClasses: Record<CardPadding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-5',
};

const toneSurfaceClasses: Record<Exclude<CardTone, 'default'>, string> = {
  subtle: 'bg-surface-2 border-line',
  brand: 'bg-brand-soft border-brand/30',
  danger: 'bg-danger-soft border-danger/30',
  warn: 'bg-warn-soft border-warn/30',
};

export const Card: React.FC<CardProps> = ({
  children,
  className = '',
  subCard = false,
  interactive = false,
  tone = 'default',
  padding = 'none',
  ...props
}) => {
  const surfaceClass =
    tone !== 'default'
      ? toneSurfaceClasses[tone]
      : subCard
        ? 'bg-surface-2 border-line'
        : 'bg-surface border-line shadow-[var(--shadow-card)]';

  return (
    <div
      className={`${subCard ? 'rounded-tile' : 'rounded-card'} border ${surfaceClass} ${paddingClasses[padding]} ${
        interactive ? 'cursor-pointer press hover:border-line-strong hover:bg-surface-2' : ''
      } ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};
