import React, { type HTMLAttributes } from 'react';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  subCard?: boolean;
}

export const Card: React.FC<CardProps> = ({
  children,
  className = '',
  subCard = false,
  ...props
}) => {
  const { cardClass, subCardClass } = useThemeTokens();
  const baseClass = subCard ? subCardClass : cardClass;

  return (
    <div className={`rounded-2xl border transition-colors ${baseClass} ${className}`} {...props}>
      {children}
    </div>
  );
};
