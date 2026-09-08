import React, { type HTMLAttributes } from 'react';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  subCard?: boolean;
  interactive?: boolean;
}

export const Card: React.FC<CardProps> = ({
  children,
  className = '',
  subCard = false,
  interactive = false,
  ...props
}) => {
  const { cardClass, subCardClass } = useThemeTokens();
  const baseClass = subCard ? subCardClass : cardClass;
  const interactiveClass = interactive
    ? 'hover:border-slate-300 dark:hover:border-white/20 transition-all duration-200 cursor-pointer active:scale-[0.99]'
    : 'transition-colors duration-150';

  return (
    <div className={`rounded-2xl border ${baseClass} ${interactiveClass} ${className}`} {...props}>
      {children}
    </div>
  );
};
