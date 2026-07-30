import {
  useMutation,
  type UseMutationOptions,
  useQueryClient,
} from '@tanstack/react-query';
import { App } from 'antd';
import { asErrorMessage } from '@/api/http';

export function useApiMutation<TData, TVariables, TError = Error>(
  options: UseMutationOptions<TData, TError, TVariables>,
  invalidationKeys: readonly (readonly unknown[])[] = [],
) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const mutation = useMutation<TData, TError, TVariables>({
    ...options,
  });

  const wrapped = {
    ...mutation,
    mutateAsync: async (variables: TVariables): Promise<TData> => {
      try {
        const result = await mutation.mutateAsync(variables);
        if (invalidationKeys.length > 0) {
          await Promise.all(
            invalidationKeys.map((key) =>
              queryClient.invalidateQueries({ queryKey: key as unknown[] }),
            ),
          );
        }
        return result;
      } catch (error) {
        const detail = asErrorMessage(error);
        message.error(detail);
        throw error;
      }
    },
  };

  return wrapped;
}
