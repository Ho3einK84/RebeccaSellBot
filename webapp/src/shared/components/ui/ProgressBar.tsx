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

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  tone = 'brand',
  size = 'sm',
  className = '',
  label,
}) => {
  const clamped = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={`w-full overflow-hidden rounded-full bg-surface-3 ${
        size === 'md' ? 'h-2' : 'h-1.5'
      } ${className}`}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-300 ease-out ${fillTone[tone]}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
};
