export type MessageType = 'info' | 'success' | 'warning' | 'error';

export type MessagePosition =
  | 'topLeft'
  | 'topCenter'
  | 'topRight'
  | 'bottomLeft'
  | 'bottomCenter'
  | 'bottomRight'
  | 'center';

export interface MessageOptions {
  content: string;
  type?: MessageType;
  duration?: number; // 持续时间，单位毫秒，0表示不自动关闭
  position?: MessagePosition;
  showClose?: boolean; // 是否显示关闭按钮
  onClose?: () => void; // 关闭回调
}

export interface MessageInstance extends MessageOptions {
  id: string;
  visible: boolean;
  timer?: number;
}

export interface MessageAPI {
  show: (options: MessageOptions) => string;
  info: (content: string, options?: Partial<MessageOptions>) => string;
  success: (content: string, options?: Partial<MessageOptions>) => string;
  warning: (content: string, options?: Partial<MessageOptions>) => string;
  error: (content: string, options?: Partial<MessageOptions>) => string;
  removeAll: () => void;
}
