import React, { type ReactNode } from 'react';

export type TileTone = 'brand' | 'ok' | 'warn' | 'danger' | 'info' | 'neutral';
export type TileSize = 'sm' | 'md' | 'lg';

const toneClasses: Record<TileTone, string> = {
  brand: 'bg-brand-soft text-brand border-brand/25',
  ok: 'bg-ok-soft text-ok border-ok/25',
  warn: 'bg-warn-soft text-warn border-warn/25',
  danger: 'bg-danger-soft text-danger border-danger/25',
  info: 'bg-info-soft text-info border-info/25',
  neutral: 'bg-surface-2 text-ink-soft border-line',
};

const sizeClasses: Record<TileSize, string> = {
  sm: 'w-8 h-8 rounded-[0.625rem] [&>svg]:w-4 [&>svg]:h-4',
  md: 'w-10 h-10 rounded-tile [&>svg]:w-[18px] [&>svg]:h-[18px]',
  lg: 'w-12 h-12 rounded-tile [&>svg]:w-5 [&>svg]:h-5',
};

interface IconTileProps {
  children: ReactNode;
  tone?: TileTone;
  size?: TileSize;
  className?: string;
}

/**
 * Single icon-container recipe shared by the admin panel and the user portal
 * (previously every screen rolled its own gradient/border/radius combination).
 */
export const IconTile: React.FC<IconTileProps> = ({
  children,
  tone = 'brand',
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
