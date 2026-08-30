import axios, { AxiosError } from 'axios';
import { App } from 'antd';
import type { ApiError } from '@/types/common';
import type { ModalStaticFunctions } from 'antd/es/modal/confirm';

let messageApi: ReturnType<typeof App.useApp>['message'] | null = null;
let notificationApi: ReturnType<typeof App.useApp>['notification'] | null = null;
let modalApi: Omit<ModalStaticFunctions, 'warn'> | null = null;

export function bindAntdApis(apIs: ReturnType<typeof App.useApp>): void {
  messageApi = apIs.message;
  notificationApi = apIs.notification;
  modalApi = apIs.modal;
}

export function getModalApi(): Omit<ModalStaticFunctions, 'warn'> | null {
  return modalApi;
}

import type { CurrentUser } from './auth';

export const AUTH_STORAGE_KEY = 'mini-pipeline-auth';

export type StoredAuth = {
  token: string;
  user: CurrentUser;
};

export function loadStoredAuth(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    // The zustand persist middleware stores {"state": {...}, "version": 0};
    // accept both that envelope and a bare {token, user} object.
    const parsed = JSON.parse(raw) as Partial<StoredAuth> & {
      state?: Partial<StoredAuth>;
    };
    const candidate = parsed.state?.token ? parsed.state : parsed;
    return candidate.token ? (candidate as StoredAuth) : null;
  } catch {
    return null;
  }
}

export function storeAuth(auth: StoredAuth | null): void {
  // Null removes the key entirely; non-null writes are handled by the
  // zustand persist middleware (this stays for force-logout cleanup).
  if (!auth) {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }
}

/** A 401 from the API means the session is gone — drop it and re-login. */
export function onUnauthorized(): void {
  storeAuth(null);
  if (!window.location.pathname.startsWith('/login')) {
    window.location.assign('/login');
  }
}

export const http = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30_000,
});

http.interceptors.request.use((config) => {
  const auth = loadStoredAuth();
  if (auth) {
    config.headers.set('Authorization', `Bearer ${auth.token}`);
  }
  return config;
});

http.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiError>) => {
    const status = error.response?.status;
    const detail =
      (typeof error.response?.data === 'object' &&
        error.response?.data !== null &&
        'detail' in error.response.data &&
        typeof error.response.data.detail === 'string' &&
        error.response.data.detail) ||
      error.message ||
      'Request failed';

    if (status === 401) {
      onUnauthorized();
    }

    if (messageApi) {
      if (status === 404) {
        messageApi.warning(detail);
      } else if (status === 401 || status === 403) {
        messageApi.error(detail);
      } else if (status && status >= 500) {
        notificationApi?.error({
          message: `Server error (${String(status)})`,
          description: detail,
          placement: 'topRight',
        });
      } else {
        messageApi.error(detail);
      }
    }

    return Promise.reject(new Error(detail));
  },
);

export function asErrorMessage(error: unknown, fallback = 'Request failed'): string {
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}
