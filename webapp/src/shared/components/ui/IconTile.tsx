import React, { type ReactNode } from 'react';

export type TileTone = 'brand' | 'accent' | 'ok' | 'warn' | 'danger' | 'info' | 'neutral';
export type TileSize = 'sm' | 'md' | 'lg';

const toneClasses: Record<TileTone, string> = {
  brand: 'bg-brand-soft text-brand-fg border-brand/15',
  accent: 'bg-accent-soft text-accent-fg border-accent/15',
  ok: 'bg-ok-soft text-ok-fg border-ok/15',
  warn: 'bg-warn-soft text-warn-fg border-warn/15',
  danger: 'bg-danger-soft text-danger-fg border-danger/15',
  info: 'bg-info-soft text-info-fg border-info/15',
  neutral: 'bg-surface-2 text-ink-soft border-line',
};

const sizeClasses: Record<TileSize, string> = {
  sm: 'w-8 h-8 rounded-[10px] [&>svg]:w-4 [&>svg]:h-4',
  md: 'w-10 h-10 rounded-[13px] [&>svg]:w-[19px] [&>svg]:h-[19px]',
  lg: 'w-12 h-12 rounded-[15px] [&>svg]:w-5 [&>svg]:h-5',
};

interface IconTileProps {
  children: ReactNode;
  tone?: TileTone;
  size?: TileSize;
  className?: string;
}

export const IconTile: React.FC<IconTileProps> = ({
  children,
  tone = 'neutral',
  size = 'md',
  className = '',
}) => (
  <span
    className={`inline-flex items-center justify-center shrink-0 border shadow-[var(--rs-specular-top)] transition-transform duration-200 ease-[var(--ease-spring)] group-hover:scale-[1.06] ${sizeClasses[size]} ${toneClasses[tone]} ${className}`}
    aria-hidden="true"
  >
    {children}
  </span>
);
