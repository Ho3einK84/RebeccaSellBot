import { forwardRef, type InputHTMLAttributes } from 'react';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  className?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', ...props }, ref) => {
    const { inputClass } = useThemeTokens();
    return (
      <input
        ref={ref}
        className={`w-full h-11 px-3.5 text-sm rounded-ctl border outline-none rs-focus transition-colors duration-150 disabled:opacity-50 ${inputClass} ${className}`}
        {...props}
      />
    );
  }
);

Input.displayName = 'Input';
