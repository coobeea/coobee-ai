export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'info' | 'warning' | 'error' | 'success';
  showIcon?: boolean;
  persistent?: boolean;
  showCancelButton?: boolean;
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
}

export interface ConfirmInstance extends ConfirmOptions {
  id: string;
  visible: boolean;
  loading?: boolean;
}

export interface ConfirmAPI {
  show: (options: ConfirmOptions) => Promise<boolean>;
  info: (message: string, options?: Partial<ConfirmOptions>) => Promise<boolean>;
  warning: (message: string, options?: Partial<ConfirmOptions>) => Promise<boolean>;
  error: (message: string, options?: Partial<ConfirmOptions>) => Promise<boolean>;
  success: (message: string, options?: Partial<ConfirmOptions>) => Promise<boolean>;
}
