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
  /** Optional responsive/layout classes applied to the footer strip. */
  footerClassName?: string;
  className?: string;
}

/**
 * Unified top chrome shared by User Portal and Admin Console.
 * Uses flat matte surface depth, crisp 1px structural borders, and strict
 * truncation boundaries so identity text never collides with action controls.
 */
export const TopBar: React.FC<TopBarProps> = ({
  icon,
  title,
  badge,
  subtitle,
  actions,
  footer,
  footerClassName = '',
  className = '',
}) => (
  <header
    className={`rounded-card border border-line bg-surface/94 rs-backdrop-blur px-3.5 py-2.5 sm:px-4 sm:py-3 shadow-[var(--shadow-card)] transition-shadow duration-200 ${className}`}
  >
    <div className="flex items-center justify-between gap-2.5 min-w-0">
      <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1 overflow-hidden">
        {icon ? <div className="shrink-0">{icon}</div> : null}
        <div className="min-w-0 flex-1 text-start overflow-hidden">
          <div className="flex items-center gap-2 min-w-0 overflow-hidden">
            <h1 className="truncate font-semibold text-sm sm:text-[15px] text-ink leading-[1.35] m-0">
              {title}
            </h1>
            {badge}
          </div>
          {subtitle ? (
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-muted min-w-0 overflow-hidden">
              {subtitle}
            </div>
          ) : null}
        </div>
      </div>

      {actions ? <div className="flex items-center gap-1.5 shrink-0">{actions}</div> : null}
    </div>

    {footer ? (
      <div
        className={`mt-2.5 pt-2.5 border-t border-line/80 flex items-center justify-between gap-2 text-xs ${footerClassName}`}
      >
        {footer}
      </div>
    ) : null}
  </header>
);
