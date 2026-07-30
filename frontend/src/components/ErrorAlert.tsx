import React from "react";
import { Alert } from 'antd';
import { describeError } from '@/hooks/useApiQuery';

type Props = {
  error: unknown;
  onRetry?: () => void;
};

export function ErrorAlert({ error, onRetry }: Props): React.JSX.Element {
  return (
    <Alert
      type="error"
      showIcon
      message="Request failed"
      description={describeError(error)}
      action={
        onRetry ? (
          <a onClick={onRetry} role="button">
            Retry
          </a>
        ) : null
      }
    />
  );
}
