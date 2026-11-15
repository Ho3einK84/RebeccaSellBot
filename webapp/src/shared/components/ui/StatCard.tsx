import React, { type ReactNode } from 'react';
import { Card } from './Card.js';
import { IconTile, type TileTone } from './IconTile.js';

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
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-ink-muted">{label}</span>
          <div className="mt-1.5 flex items-baseline gap-1.5 flex-wrap min-w-0">
            <span className="tnum text-lg sm:text-2xl font-bold text-ink leading-tight">
              {value}
            </span>
            {unit ? <span className="text-[11px] font-normal text-ink-muted">{unit}</span> : null}
          </div>
        </div>

        {aside ? (
          <div className="shrink-0">{aside}</div>
        ) : icon ? (
          <IconTile tone={tone} size="sm" className="shrink-0">
            {icon}
          </IconTile>
        ) : null}
      </div>

      {hint ? <div className="text-[11px] text-ink-soft leading-relaxed">{hint}</div> : null}
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
