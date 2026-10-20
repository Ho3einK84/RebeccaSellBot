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
    className={`flex flex-col items-center justify-center text-center gap-2.5 rounded-card border border-dashed border-line px-5 py-9 anim-fade ${className}`}
  >
    {icon ? (
      <IconTile tone={tone} size="lg">
        {icon}
      </IconTile>
    ) : null}
    <p className="text-sm font-semibold text-ink">{title}</p>
    {description ? (
      <p className="text-xs leading-relaxed text-ink-muted max-w-[34ch]">{description}</p>
    ) : null}
    {action ? <div className="mt-1.5">{action}</div> : null}
  </div>
);
