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

export const http = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30_000,
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
