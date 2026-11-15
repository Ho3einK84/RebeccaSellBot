import React, { type ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';

interface SectionHeaderProps {
  title: string;
  count?: ReactNode;
  icon?: ReactNode;
  /** Trailing link/action rendered cleanly with directional chevron. */
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  count,
  icon,
  actionLabel,
  onAction,
  className = '',
}) => (
  <div className={`flex items-center justify-between gap-3 ${className}`}>
    <div className="flex items-center gap-2 min-w-0">
      {icon ? (
        <span className="text-ink-muted shrink-0 [&>svg]:w-4 [&>svg]:h-4" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <h2 className="truncate font-semibold text-sm text-ink leading-[1.4] m-0">{title}</h2>
      {count !== undefined && count !== null ? (
        <span className="tnum inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-surface-2 border border-line px-1.5 text-[11px] font-medium text-ink-soft">
          {count}
        </span>
      ) : null}
    </div>

    {actionLabel && onAction ? (
      <button
        type="button"
        onClick={onAction}
        className="inline-flex h-8 items-center gap-1 rounded-ctl px-2 text-xs font-medium text-brand-fg hover:bg-brand-soft rs-focus press cursor-pointer shrink-0"
      >
        <span>{actionLabel}</span>
        <ChevronLeft className="w-3.5 h-3.5 ltr:rotate-180 shrink-0" />
      </button>
    ) : null}
  </div>
);
