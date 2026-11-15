import React, { type HTMLAttributes } from 'react';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';

export type CardTone = 'default' | 'subtle' | 'brand' | 'danger';
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

const toneClasses: Record<CardTone, string> = {
  default: '',
  subtle: '!bg-surface-2',
  brand: '!bg-brand-soft !border-brand/30',
  danger: '!bg-danger-soft !border-danger/30',
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
  const { cardClass, subCardClass } = useThemeTokens();

  return (
    <div
      className={`${subCard ? 'rounded-tile' : 'rounded-card'} border ${
        subCard ? subCardClass : cardClass
      } ${toneClasses[tone]} ${paddingClasses[padding]} ${
        interactive ? 'cursor-pointer press hover:border-line-strong hover:bg-surface-2' : ''
      } ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};
