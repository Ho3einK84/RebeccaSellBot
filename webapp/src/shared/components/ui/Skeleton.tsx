import React, { type HTMLAttributes } from 'react';

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({ className = '', ...props }) => {
  return <div className={`rs-skeleton rounded-ctl ${className}`} {...props} />;
};

export const SkeletonCard: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div
    className={`rounded-card border p-4 space-y-3 bg-surface border-line shadow-[var(--shadow-card)] ${className}`}
  >
    <div className="flex items-center justify-between">
      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="h-7 w-7 rounded-ctl" />
    </div>
    <Skeleton className="h-7 w-32" />
    <Skeleton className="h-3 w-40" />
  </div>
);

export const SkeletonStatsGrid: React.FC<{ count?: number }> = ({ count = 4 }) => (
  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
    {Array.from({ length: count }).map((_, i) => (
      <SkeletonCard key={i} />
    ))}
  </div>
);

export const SkeletonList: React.FC<{ count?: number }> = ({ count = 3 }) => (
  <div className="space-y-3">
    {Array.from({ length: count }).map((_, i) => (
      <div
        key={i}
        className="rounded-card border p-4 flex items-center justify-between gap-4 bg-surface border-line shadow-[var(--shadow-card)]"
      >
        <div className="space-y-2 flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-16 rounded-full" />
          </div>
          <Skeleton className="h-3 w-44 max-w-full" />
          <Skeleton className="h-3 w-28" />
        </div>
        <div className="flex gap-2 shrink-0">
          <Skeleton className="h-9 w-18 rounded-ctl" />
          <Skeleton className="h-9 w-18 rounded-ctl" />
        </div>
      </div>
    ))}
  </div>
);
