import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
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
        className={`w-full h-11 px-3.5 text-sm rounded-ctl border outline-none rs-focus transition-all duration-150 disabled:opacity-50 ${inputClass} ${className}`}
        {...props}
      />
    );
  }
);

Input.displayName = 'Input';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  className?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className = '', ...props }, ref) => {
    const { inputClass } = useThemeTokens();
    return (
      <textarea
        ref={ref}
        className={`w-full p-3 text-xs sm:text-sm rounded-ctl border outline-none rs-focus transition-all duration-150 disabled:opacity-50 ${inputClass} ${className}`}
        {...props}
      />
    );
  }
);

Textarea.displayName = 'Textarea';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  className?: string;
  compact?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = '', compact = false, children, ...props }, ref) => {
    const { inputClass } = useThemeTokens();
    return (
      <select
        ref={ref}
        className={`w-full ${compact ? 'h-9 px-2.5 text-xs' : 'h-11 px-3 text-xs sm:text-sm'} rounded-ctl border outline-none rs-focus cursor-pointer transition-all duration-150 disabled:opacity-50 ${inputClass} ${className}`}
        {...props}
      >
        {children}
      </select>
    );
  }
);

Select.displayName = 'Select';
