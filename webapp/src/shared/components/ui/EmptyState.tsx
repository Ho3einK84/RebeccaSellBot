import React, { type ReactNode } from 'react';
import { IconTile, type TileTone } from './IconTile.js';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  tone?: TileTone;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  tone = 'neutral',
  className = '',
}) => (
  <div
    className={`anim-rise rounded-card border border-line bg-surface p-6 sm:p-8 text-center flex flex-col items-center justify-center gap-2.5 shadow-[var(--shadow-card)] ${className}`}
  >
    {icon ? (
      <IconTile tone={tone} size="lg">
        {icon}
      </IconTile>
    ) : null}
    <h3 className="text-sm font-semibold text-ink leading-[1.4] m-0 mt-1">{title}</h3>
    {description ? (
      <p className="text-xs text-ink-muted max-w-xs leading-relaxed m-0">{description}</p>
    ) : null}
    {action ? <div className="mt-2">{action}</div> : null}
  </div>
);
