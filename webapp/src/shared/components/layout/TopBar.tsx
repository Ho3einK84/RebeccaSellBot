import React, { type ReactNode } from 'react';

export interface TopBarProps {
  /** Brand mark / avatar tile rendered before the title. */
  icon?: ReactNode;
  title: string;
  badge?: ReactNode;
  /** Secondary line under the title (role, username, status). */
  subtitle?: ReactNode;
  /** Utility icon buttons rendered on the trailing edge. */
  actions?: ReactNode;
  /** Identity or mode strip rendered under a clean hairline divider. */
  footer?: ReactNode;
  className?: string;
}

/**
 * Unified top chrome shared by User Portal and Admin Console.
 * Uses flat matte surface depth and crisp 1px structural borders.
 */
export const TopBar: React.FC<TopBarProps> = ({
  icon,
  title,
  badge,
  subtitle,
  actions,
  footer,
  className = '',
}) => (
  <header
    className={`rounded-card border border-line bg-surface px-3.5 py-3 sm:px-4 sm:py-3.5 shadow-[var(--shadow-card)] ${className}`}
  >
    <div className="flex items-center justify-between gap-2.5">
      <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
        {icon}
        <div className="min-w-0 flex-1 text-start">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="truncate font-semibold text-sm sm:text-base text-ink leading-[1.4] m-0">
              {title}
            </h1>
            {badge}
          </div>
          {subtitle ? (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-muted">
              {subtitle}
            </div>
          ) : null}
        </div>
      </div>

      {actions ? (
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">{actions}</div>
      ) : null}
    </div>

    {footer ? (
      <div className="mt-3 pt-2.5 border-t border-line flex flex-wrap items-center justify-between gap-2 text-xs">
        {footer}
      </div>
    ) : null}
  </header>
);
