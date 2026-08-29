import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Spin } from 'antd';
import { getAuthMode } from '@/api/auth';
import { loadStoredAuth } from '@/api/http';

/**
 * Route guard. Server auth can be disabled (dev default): in that case the
 * API accepts anonymous requests and we skip the login redirect.
 */
export function AuthGate({ children }: { children: React.JSX.Element }): React.JSX.Element {
  const [state, setState] = useState<'loading' | 'allowed' | 'redirect'>('loading');

  useEffect(() => {
    if (loadStoredAuth()) {
      setState('allowed');
      return;
    }
    void getAuthMode()
      .then((mode) => setState(mode.enabled ? 'redirect' : 'allowed'))
      .catch(() => setState('allowed')); // server unreachable: let pages surface it
  }, []);

  if (state === 'loading') {
    return (
      <div style={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }
  if (state === 'redirect') {
    return <Navigate to="/login" replace />;
  }
  return children;
}
