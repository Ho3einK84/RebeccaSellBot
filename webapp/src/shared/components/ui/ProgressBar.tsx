import React from 'react';
import type { TileTone } from './IconTile.js';

interface ProgressBarProps {
  /** 0–100 */
  value: number;
  tone?: TileTone;
  size?: 'sm' | 'md';
  className?: string;
  label?: string;
}

const fillTone: Record<TileTone, string> = {
  brand: 'bg-brand',
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
  neutral: 'bg-ink-muted',
};

/** One usage bar for traffic/quota in both panels (RTL-safe fill origin). */
export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  tone = 'brand',
  size = 'sm',
  className = '',
  label,
}) => {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

  return (
    <div
      className={`w-full overflow-hidden rounded-full bg-surface-3 ${
        size === 'sm' ? 'h-1.5' : 'h-2.5'
      } ${className}`}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${fillTone[tone]}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
};
