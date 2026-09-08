import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';

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
      return (
        <div className="min-h-[250px] w-full flex items-center justify-center p-4">
          <div className="glass-panel p-6 max-w-md w-full text-center flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-slate-100">
              {this.props.fallbackTitle || 'خطایی رخ داد'}
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed max-w-xs">
              {this.state.error?.message ||
                this.props.fallbackMessage ||
                'متأسفانه مشکلی در نمایش این بخش پیش آمده است.'}
            </p>
            <button
              type="button"
              onClick={this.handleReset}
              className="btn btn-sm btn-outline text-xs gap-2 rounded-xl mt-2 cursor-pointer"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>تلاش مجدد</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
