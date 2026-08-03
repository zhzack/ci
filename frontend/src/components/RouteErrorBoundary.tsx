import React from "react";
import { Button, Result } from 'antd';
import { useRouteError, isRouteErrorResponse, useNavigate } from 'react-router-dom';

type State = { error: Error | null };

export class RouteErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: { componentStack?: string }): void {
    // Log full info to help localise which render produced the crash.
    console.error('Route error boundary caught:', error);
    if (info && info.componentStack) {
      console.error('Component stack:\n' + info.componentStack);
    }
  }

  resetError = (): void => {
    this.setState({ error: null });
  };

  override render(): React.ReactNode {
    if (this.state.error) {
      return <ErrorScreen message={this.state.error.message} onReset={this.resetError} />;
    }
    return this.props.children;
  }
}

function ErrorScreen({
  message,
  onReset,
}: {
  message: string;
  onReset: () => void;
}): React.JSX.Element {
  return (
    <Result
      status="error"
      title="Something went wrong"
      subTitle={message || 'An unexpected error occurred.'}
      extra={
        <Button type="primary" onClick={onReset}>
          Back to dashboard
        </Button>
      }
    />
  );
}

export function RouterErrorElement(): React.JSX.Element {
  const error = useRouteError();
  const navigate = useNavigate();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Unknown error';
  return <ErrorScreen message={message} onReset={() => navigate('/dashboard', { replace: true })} />;
}
