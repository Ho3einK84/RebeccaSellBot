import { forwardRef, type InputHTMLAttributes } from 'react';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', error = false, ...props }, ref) => {
    const { inputClass } = useThemeTokens();
    const errorBorder = error ? '!border-rose-500/60 focus:!border-rose-500' : '';

    return (
      <input
        ref={ref}
        className={`input input-bordered w-full rounded-xl text-xs sm:text-sm transition-all outline-none ${inputClass} ${errorBorder} ${className}`}
        {...props}
      />
    );
  }
);

Input.displayName = 'Input';
