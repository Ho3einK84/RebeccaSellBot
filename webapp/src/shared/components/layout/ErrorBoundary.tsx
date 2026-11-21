import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in component tree:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      const isEn = typeof document !== 'undefined' && document.documentElement.lang === 'en';
      const defaultTitle = isEn ? 'Unable to load view' : 'خطا در نمایش بخش';
      const defaultBody = isEn
        ? 'An unexpected rendering issue interrupted this screen.'
        : 'مشکلی در بارگذاری این بخش رخ داده است';
      const retryLabel = isEn ? 'Retry' : 'تلاش مجدد';

      return (
        <div
          dir={isEn ? 'ltr' : 'rtl'}
          className="min-h-[100dvh] w-full flex items-center justify-center p-4 bg-canvas text-ink safe-top safe-bottom"
        >
          <div className="rounded-card border border-line bg-surface p-6 max-w-md w-full text-center flex flex-col items-center gap-3.5 shadow-[var(--shadow-card)] anim-rise">
            <div className="w-12 h-12 rounded-tile bg-danger-soft border border-danger/25 flex items-center justify-center text-danger-fg">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-ink m-0 leading-[1.4]">
                {this.props.fallbackTitle || defaultTitle}
              </h3>
              <p className="text-xs text-ink-muted leading-relaxed max-w-xs m-0">
                {this.state.error?.message || this.props.fallbackMessage || defaultBody}
              </p>
            </div>
            <button
              type="button"
              onClick={this.handleReset}
              className="mt-1 inline-flex h-10 items-center justify-center gap-2 rounded-ctl border border-line-strong bg-surface-2 px-4 text-xs font-medium text-ink hover:bg-surface-3 rs-focus press cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{retryLabel}</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
