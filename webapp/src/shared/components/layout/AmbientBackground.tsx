import React, { memo } from 'react';

export const AmbientBackground: React.FC = memo(() => {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-0" aria-hidden="true">
      <div className="cs-orb cs-orb-1" />
      <div className="cs-orb cs-orb-2" />
      <div className="cs-orb cs-orb-3" />
      <div className="absolute inset-0 cs-grid-overlay" />
    </div>
  );
});

AmbientBackground.displayName = 'AmbientBackground';
