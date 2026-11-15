import React, { type ReactNode } from 'react';
import { Card } from './Card.js';
import type { TileTone } from './IconTile.js';

interface StatCardProps {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: TileTone;
  /** Rendered at the far end of the title row. */
  aside?: ReactNode;
  /** Trailing action rendered at the bottom of the card. */
  action?: ReactNode;
  /** Optional click handler making the whole stat card interactive. */
  onClick?: () => void;
  /** Stagger index kept for compatibility. */
  index?: number;
  className?: string;
}

const iconToneClasses: Record<TileTone, string> = {
  brand: 'text-brand-fg',
  ok: 'text-ok-fg',
  warn: 'text-warn-fg',
  danger: 'text-danger-fg',
  info: 'text-info-fg',
  neutral: 'text-ink-muted',
};

export const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  unit,
  hint,
  icon,
  tone = 'neutral',
  aside,
  action,
  onClick,
  className = '',
}) => {
  const cardNode = (
    <Card
      padding="md"
      interactive={Boolean(onClick)}
      className={`flex flex-col justify-between gap-2.5 ${onClick ? 'h-full' : ''} ${className}`}
    >
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          {icon ? (
            <span
              aria-hidden="true"
              className={`inline-flex items-center justify-center shrink-0 [&>svg]:w-4 [&>svg]:h-4 ${iconToneClasses[tone]}`}
            >
              {icon}
            </span>
          ) : null}
          <span className="truncate text-xs font-medium text-ink-muted">{label}</span>
        </div>
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </div>

      <div className="flex items-baseline gap-1.5 flex-wrap min-w-0">
        <span className="tnum text-xl sm:text-2xl font-semibold text-ink leading-tight">
          {value}
        </span>
        {unit ? <span className="text-xs font-normal text-ink-muted">{unit}</span> : null}
      </div>

      {hint ? <div className="text-xs text-ink-soft leading-relaxed">{hint}</div> : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </Card>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="block w-full h-full text-start cursor-pointer press rs-focus rounded-card"
      >
        {cardNode}
      </button>
    );
  }

  return cardNode;
};
