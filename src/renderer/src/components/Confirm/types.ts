export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'info' | 'warning' | 'error' | 'success';
  showIcon?: boolean;
  persistent?: boolean; // 新增：是否为持久对话框，点击外部或按ESC键不会关闭
  showCancelButton?: boolean; // 新增：是否显示取消按钮
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
