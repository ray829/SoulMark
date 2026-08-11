import { Component, type ReactNode } from "react";

/**
 * 编辑器错误边界：渲染异常时降级显示错误信息，避免整页白屏。
 * fallback 可自定义；默认显示错误 message + 提示重新打开文件。
 */
interface Props {
  children: ReactNode;
  fallback?: (error: Error) => ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown): void {
    console.error("[ErrorBoundary]", error, info);
  }

  render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error);
      return (
        <div
          style={{
            padding: "48px",
            textAlign: "center",
            color: "var(--text-secondary)",
          }}
        >
          <p style={{ fontSize: "15px", marginBottom: "8px" }}>
            编辑器渲染异常
          </p>
          <pre
            style={{
              margin: "0 auto 16px",
              maxWidth: "600px",
              padding: "12px",
              background: "var(--hover)",
              borderRadius: "6px",
              fontSize: "12px",
              color: "var(--danger)",
              whiteSpace: "pre-wrap",
              textAlign: "left",
            }}
          >
            {this.state.error.message}
          </pre>
          <p style={{ fontSize: "13px" }}>请尝试重新打开文件</p>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
