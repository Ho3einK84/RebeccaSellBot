import { forwardRef, type InputHTMLAttributes } from 'react';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', error = false, ...props }, ref) => {
    const { inputClass } = useThemeTokens();
    const errorBorder = error
      ? '!border-rose-500/60 focus:!border-rose-500 focus:!ring-rose-500/20'
      : '';

    return (
      <input
        ref={ref}
        className={`w-full h-10 px-3.5 rounded-xl border text-xs sm:text-sm transition-all outline-none shadow-[0_1px_2px_rgba(0,0,0,0.02)] ${inputClass} ${errorBorder} ${className}`}
        {...props}
      />
    );
  }
);

Input.displayName = 'Input';
