import { Component, type ErrorInfo, type ReactNode } from 'react';
import { createLogger } from '@/utils/logger';

const log = createLogger('error-boundary');

interface ErrorBoundaryProps {
  children: ReactNode;
  /** 出错时展示的兜底 UI；不传则用内置的 */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * 错误边界。
 *
 * Markdown 渲染要执行大量第三方逻辑（KaTeX / Mermaid / 用户自定义 JS），
 * 任何一处抛错都不应该把整个阅读器变成白屏。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  /** 捕获渲染期异常 */
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  /** 记录错误详情 */
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    log.error('组件树渲染失败', error, info.componentStack);
  }

  /** 清除错误状态，重新挂载子树 */
  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm font-medium" style={{ color: 'var(--app-danger)' }}>
          渲染出错了
        </p>
        <p className="max-w-md text-xs" style={{ color: 'var(--app-text-muted)' }}>
          {error.message}
        </p>
        <button
          type="button"
          onClick={this.reset}
          className="rounded-md px-3 py-1.5 text-xs transition-colors duration-[var(--app-duration)]"
          style={{
            background: 'var(--app-accent)',
            color: 'var(--app-accent-contrast)',
          }}
        >
          重试
        </button>
      </div>
    );
  }
}
