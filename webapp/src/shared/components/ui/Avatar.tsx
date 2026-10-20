import React, { useState } from 'react';
import { getAvatarChar } from '@/shared/lib/formatters.js';

interface AvatarProps {
  name?: string | null;
  username?: string | null;
  photoUrl?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  circle?: boolean;
  className?: string;
}

const sizeClasses = {
  xs: 'w-7 h-7 text-xs',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm font-bold',
  lg: 'w-12 h-12 text-base font-bold',
  xl: 'w-16 h-16 text-xl font-bold',
} as const;

const radiusClasses = {
  xs: 'rounded-lg',
  sm: 'rounded-ctl',
  md: 'rounded-ctl',
  lg: 'rounded-tile',
  xl: 'rounded-tile',
} as const;

export const Avatar: React.FC<AvatarProps> = ({
  name,
  username,
  photoUrl,
  size = 'md',
  circle = false,
  className = '',
}) => {
  const [hasError, setHasError] = useState(false);
  const radiusClass = circle ? 'rounded-full' : radiusClasses[size];

  if (photoUrl && !hasError) {
    return (
      <img
        src={photoUrl}
        alt={name || username || 'User'}
        className={`${radiusClass} shrink-0 border border-line object-cover shadow-e1 ${sizeClasses[size]} ${className}`}
        onError={() => setHasError(true)}
      />
    );
  }

  const char = getAvatarChar(name, username);

  return (
    <div
      className={`${radiusClass} flex shrink-0 select-none items-center justify-center border border-brand/25 bg-brand-soft text-brand select-none transition-colors shadow-e1 ${sizeClasses[size]} ${className}`}
    >
      <span>{char}</span>
    </div>
  );
};
