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
  /** Rendered at the far end of the title row (badge, live dot, …). */
  aside?: ReactNode;
  /** Trailing action rendered at the bottom of the card. */
  action?: ReactNode;
  /** Stagger index for `anim-stagger` containers. */
  index?: number;
  /** Makes the whole card a tappable surface (drill-down to a tab). */
  onClick?: () => void;
  className?: string;
}

const valueTone: Record<TileTone, string> = {
  brand: 'text-ink',
  neutral: 'text-ink',
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
  info: 'text-info',
};

/**
 * The one KPI card used everywhere (admin overview + user dashboard).
 * Fixes the old drift: text column was top-aligned with dead space below,
 * title→value→hint spacing was inconsistent, and the icon floated.
 */
export const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  unit,
  hint,
  icon,
  tone = 'brand',
  aside,
  action,
  index,
  onClick,
  className = '',
}) => (
  <Card
    interactive={Boolean(onClick)}
    onClick={onClick}
    className={`p-4 anim-rise ${className}`}
    style={index === undefined ? undefined : ({ '--i': index } as React.CSSProperties)}
  >
    <div className="flex items-start gap-3">
      {icon ? <IconTile tone={tone}>{icon}</IconTile> : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-medium leading-snug text-ink-soft">{label}</span>
          {aside}
        </div>
        <div className="mt-1.5 flex min-w-0 items-baseline gap-1.5">
          <span
            className={`min-w-0 truncate text-[24px] leading-none font-bold tnum ${valueTone[tone]}`}
            title={
              typeof value === 'string' || typeof value === 'number' ? String(value) : undefined
            }
          >
            {value}
          </span>
          {unit ? <span className="shrink-0 pb-0.5 text-[11px] text-ink-muted">{unit}</span> : null}
        </div>
        {hint ? <p className="mt-1.5 text-[11px] leading-relaxed text-ink-muted">{hint}</p> : null}
      </div>
    </div>
    {action ? <div className="mt-3">{action}</div> : null}
  </Card>
);
