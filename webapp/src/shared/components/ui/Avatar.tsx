import React, { useEffect, useState } from 'react';
import { User } from 'lucide-react';
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
  md: 'w-10 h-10 text-sm',
  lg: 'w-12 h-12 text-base',
  xl: 'w-16 h-16 text-xl',
} as const;

export const Avatar: React.FC<AvatarProps> = ({
  name,
  username,
  photoUrl,
  size = 'md',
  circle = false,
  className = '',
}) => {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [photoUrl]);

  const char = getAvatarChar(name, username);
  const isFallbackEmoji = char === '👤';
  const radiusClass = circle ? 'rounded-full' : 'rounded-tile';

  if (photoUrl && !imgError) {
    return (
      <img
        src={photoUrl}
        alt={name || username || 'Avatar'}
        onError={() => setImgError(true)}
        className={`object-cover shrink-0 border border-line bg-surface-2 select-none ${radiusClass} ${sizeClasses[size]} ${className}`}
      />
    );
  }

  return (
    <div
      className={`flex items-center justify-center shrink-0 font-semibold border border-line-strong bg-surface-2 text-ink-soft select-none ${radiusClass} ${sizeClasses[size]} ${className}`}
    >
      {isFallbackEmoji ? <User className="w-[45%] h-[45%] text-ink-muted" /> : char}
    </div>
  );
};
