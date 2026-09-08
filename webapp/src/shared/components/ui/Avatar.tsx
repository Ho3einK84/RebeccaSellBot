import React from 'react';
import { getAvatarChar } from '@/shared/lib/formatters.js';
import { useTheme } from '@/shared/theme/ThemeContext.js';

interface AvatarProps {
  name?: string | null;
  username?: string | null;
  photoUrl?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export const Avatar: React.FC<AvatarProps> = ({
  name,
  username,
  photoUrl,
  size = 'md',
  className = '',
}) => {
  const { isDark } = useTheme();

  const sizeClasses = {
    xs: 'w-7 h-7 text-xs',
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm font-bold',
    lg: 'w-12 h-12 text-base font-bold',
    xl: 'w-16 h-16 text-xl font-bold',
  }[size];

  const radiusClasses = {
    xs: 'rounded-lg',
    sm: 'rounded-xl',
    md: 'rounded-xl',
    lg: 'rounded-2xl',
    xl: 'rounded-2xl',
  }[size];

  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={name || username || 'User'}
        className={`${radiusClasses} object-cover shrink-0 border border-slate-200/80 dark:border-white/10 shadow-xs ${sizeClasses} ${className}`}
        onError={(e) => {
          // Hide broken image
          (e.target as HTMLElement).style.display = 'none';
        }}
      />
    );
  }

  const char = getAvatarChar(name, username);

  return (
    <div
      className={`${radiusClasses} flex items-center justify-center shrink-0 border select-none transition-colors shadow-xs ${sizeClasses} ${
        isDark
          ? 'bg-gradient-to-tr from-indigo-500/15 via-violet-500/15 to-purple-500/15 border-indigo-500/25 text-indigo-300'
          : 'bg-gradient-to-tr from-indigo-50 to-violet-50 border-indigo-200 text-indigo-700'
      } ${className}`}
    >
      <span>{char}</span>
    </div>
  );
};
