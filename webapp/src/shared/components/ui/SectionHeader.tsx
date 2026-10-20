import React, { type ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';

interface SectionHeaderProps {
  title: string;
  count?: ReactNode;
  icon?: ReactNode;
  /** Trailing link/action. Always rendered with the same chevron + weight. */
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

/**
 * Uniform section heading for both panels: title (with optional icon and
 * count) on the start edge, one consistent chevron link on the end edge.
 * Previously every section invented its own spacing / arrow / link style.
 */
export const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  count,
  icon,
  actionLabel,
  onAction,
  className = '',
}) => (
  <div className={`mb-2.5 flex items-center justify-between gap-3 ${className}`}>
    <div className="flex items-center gap-2 min-w-0">
      {icon ? <span className="text-brand shrink-0 [&>svg]:w-4 [&>svg]:h-4">{icon}</span> : null}
      <h2 className="text-[15px] font-semibold text-ink truncate">{title}</h2>
      {count !== undefined && count !== null ? (
        <span className="text-[11px] font-medium tnum px-1.5 h-5 inline-flex items-center rounded-full bg-surface-2 border border-line text-ink-soft">
          {count}
        </span>
      ) : null}
    </div>
    {actionLabel && onAction ? (
      <button
        type="button"
        onClick={onAction}
        className="press rs-focus inline-flex items-center gap-0.5 text-xs font-medium text-brand hover:text-brand/80 rounded-ctl px-1 py-1 shrink-0"
      >
        {actionLabel}
        <ChevronLeft className="w-3.5 h-3.5" />
      </button>
    ) : null}
  </div>
);
