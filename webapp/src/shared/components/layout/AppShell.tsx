import React, { type ReactNode } from 'react';

interface AppShellProps {
  children: ReactNode;
  /** Header rendered at the top of the workspace column. */
  header?: ReactNode;
  /** Fixed bottom navigation (mobile < md). */
  bottomNav?: ReactNode;
  /** Desktop tab rail (md+). */
  desktopNav?: ReactNode;
  /** Optional overlays rendered outside the scroll column. */
  overlay?: ReactNode;
  /**
   * `wide` = full operational console width (max-w-6xl),
   * `narrow` = user portal workspace (expands cleanly on desktop when tabbed).
   */
  width?: 'wide' | 'narrow';
  /** Changing this key replays the subtle tab entrance animation. */
  transitionKey?: string | number;
  className?: string;
}

/**
 * Shared frame rendered by User Portal and Admin Console so every screen
 * inhabits the exact same coordinate grid, surface rhythm, and safe-area behavior.
 */
export const AppShell: React.FC<AppShellProps> = ({
  children,
  header,
  bottomNav,
  desktopNav,
  overlay,
  width = 'wide',
  transitionKey,
  className = '',
}) => {
  const maxWidthClass = width === 'wide' ? 'max-w-6xl' : desktopNav ? 'max-w-5xl' : 'max-w-lg';

  return (
    <div
      className={`relative flex min-h-[100dvh] w-full flex-col rs-canvas-bg bg-canvas text-ink safe-top ${className}`}
    >
      <div
        className={`relative z-10 mx-auto flex w-full flex-1 flex-col gap-4 px-3.5 pt-3 sm:px-5 sm:pt-5 ${maxWidthClass} ${
          bottomNav ? 'nav-inset' : 'pb-8'
        }`}
      >
        {header}
        {desktopNav}
        <main key={transitionKey} className="flex-1 min-w-0 anim-rise">
          {children}
        </main>
      </div>

      {bottomNav}
      {overlay}
    </div>
  );
};
