import { forwardRef, type InputHTMLAttributes } from 'react';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', error = false, ...props }, ref) => {
    const { inputClass } = useThemeTokens();
    const errorBorder = error ? '!border-danger/70 focus:!ring-danger/25' : '';

    return (
      <input
        ref={ref}
        className={`w-full h-11 px-3.5 rounded-ctl border text-sm transition-[border-color,box-shadow,background-color] outline-none focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${inputClass} ${errorBorder} ${className}`}
        {...props}
      />
    );
  }
);

Input.displayName = 'Input';
