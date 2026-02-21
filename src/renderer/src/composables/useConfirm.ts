import { inject } from 'vue';

import type { ConfirmAPI } from '@/components/Confirm/types';

export const useConfirm = (): ConfirmAPI => {
  const confirm = inject<ConfirmAPI>('$confirm');

  if (!confirm) {
    throw new Error('useConfirm must be used within a component that has access to $confirm');
  }

  return confirm;
};
