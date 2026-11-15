import React, { type ReactNode } from 'react';

export type TileTone = 'brand' | 'ok' | 'warn' | 'danger' | 'info' | 'neutral';
export type TileSize = 'sm' | 'md' | 'lg';

const toneClasses: Record<TileTone, string> = {
  brand: 'bg-brand-soft text-brand-fg border-brand/20',
  ok: 'bg-ok-soft text-ok-fg border-ok/20',
  warn: 'bg-warn-soft text-warn-fg border-warn/20',
  danger: 'bg-danger-soft text-danger-fg border-danger/20',
  info: 'bg-info-soft text-info-fg border-info/20',
  neutral: 'bg-surface-2 text-ink-soft border-line',
};

const sizeClasses: Record<TileSize, string> = {
  sm: 'w-8 h-8 rounded-ctl [&>svg]:w-4 [&>svg]:h-4',
  md: 'w-10 h-10 rounded-tile [&>svg]:w-[18px] [&>svg]:h-[18px]',
  lg: 'w-12 h-12 rounded-tile [&>svg]:w-5 [&>svg]:h-5',
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
    className={`inline-flex items-center justify-center shrink-0 border ${sizeClasses[size]} ${toneClasses[tone]} ${className}`}
    aria-hidden="true"
  >
    {children}
  </span>
);
