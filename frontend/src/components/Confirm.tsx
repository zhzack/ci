import type { ModalFuncProps } from 'antd';
import { getModalApi } from '@/api/http';

type Options = Pick<ModalFuncProps, 'title' | 'content' | 'okText' | 'cancelText' | 'okButtonProps'>;

export function confirmDanger(options: Options): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = getModalApi();
    const params: ModalFuncProps = {
      title: options.title ?? 'Confirm',
      content: options.content ?? '',
      okText: options.okText ?? 'Confirm',
      cancelText: options.cancelText ?? 'Cancel',
      okButtonProps: { danger: true, ...(options.okButtonProps ?? {}) },
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    };
    if (modal) {
      modal.confirm(params);
    } else {
      // Fallback: use static method (may miss theme but still works)
      import('antd').then(({ Modal }) => Modal.confirm(params));
    }
  });
}
