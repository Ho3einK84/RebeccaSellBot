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
  accent: 'bg-accent',
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
      className={`w-full overflow-hidden rounded-full bg-surface-3 shadow-[var(--shadow-inset-track)] ${
        size === 'md' ? 'h-2' : 'h-1.5'
      } ${className}`}
    >
      <div
        className={`relative h-full overflow-hidden rounded-full transition-[width] duration-500 ease-[var(--ease-out-calm)] after:pointer-events-none after:absolute after:inset-x-0 after:top-0 after:h-[45%] after:rounded-full after:bg-white/25 ${fillTone[tone]}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
};
