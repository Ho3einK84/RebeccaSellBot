import React, { type ReactNode } from 'react';
import { AmbientBackground } from './AmbientBackground.js';

interface AppShellProps {
  children: ReactNode;
  /** Sticky/regular header rendered inside the content column. */
  header?: ReactNode;
  /** Fixed bottom navigation (mobile). */
  bottomNav?: ReactNode;
  /** Desktop tab rail. */
  desktopNav?: ReactNode;
  /** Overlays (toasts, sheets) rendered outside the scroll column. */
  overlay?: ReactNode;
  /** `wide` = admin (max-w-6xl), `narrow` = user portal content column. */
  width?: 'wide' | 'narrow';
  /** Changing this key replays the tab entrance animation. */
  transitionKey?: string;
  className?: string;
}

/**
 * One layout skeleton for both surfaces: canvas background, ambient orbs,
 * safe-area aware top padding, a scroll column that always clears the floating
 * bottom navigation, and a keyed entrance animation for tab switches.
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
}) => (
  <div
    className={`relative flex min-h-[100dvh] w-full flex-col bg-canvas text-ink transition-colors duration-200 safe-top ${className}`}
  >
    <AmbientBackground />

    <main
      className={`nav-inset relative z-10 mx-auto flex w-full flex-1 flex-col px-3 pt-3 sm:px-5 sm:pt-5 ${
        width === 'wide' ? 'max-w-6xl' : 'max-w-lg'
      }`}
    >
      {header}
      {desktopNav}
      <div key={transitionKey} className="anim-rise flex flex-1 flex-col">
        {children}
      </div>
    </main>

    {bottomNav}
    {overlay}
  </div>
);
