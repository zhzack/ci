import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { asErrorMessage } from '@/api/http';

export function useApiQuery<TData, TError = Error>(
  key: readonly unknown[],
  fetcher: () => Promise<TData>,
  options?: Omit<UseQueryOptions<TData, TError, TData>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<TData, TError>({
    queryKey: key as unknown[],
    queryFn: fetcher,
    ...options,
  });
}

export function describeError(error: unknown): string {
  return asErrorMessage(error);
}
