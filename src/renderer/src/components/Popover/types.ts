/**
 * Popover 组件类型定义
 */

export type PopoverPlacement =
  | 'top'
  | 'top-start'
  | 'top-end'
  | 'bottom'
  | 'bottom-start'
  | 'bottom-end'
  | 'left'
  | 'left-start'
  | 'left-end'
  | 'right'
  | 'right-start'
  | 'right-end';

export type PopoverTrigger = 'click' | 'hover' | 'focus' | 'manual';

export type PopoverTheme = 'light' | 'dark';

export type PopoverSize = 'small' | 'medium' | 'large';

export interface PopoverOptions {
  /** Popover 内容 */
  content?: string;
  /** 是否支持 HTML 内容 */
  html?: boolean;
  /** 显示位置 */
  placement?: PopoverPlacement;
  /** 触发方式 */
  trigger?: PopoverTrigger;
  /** 主题样式 */
  theme?: PopoverTheme;
  /** 尺寸大小 */
  size?: PopoverSize;
  /** 是否显示箭头 */
  arrow?: boolean;
  /** 是否可关闭 */
  closable?: boolean;
  /** 显示延迟（毫秒） */
  delay?: number;
  /** 隐藏延迟（毫秒） */
  hideDelay?: number;
  /** 偏移距离 */
  offset?: number;
  /** 是否禁用 */
  disabled?: boolean;
  /** 最大宽度 */
  maxWidth?: string;
  /** 最小宽度 */
  minWidth?: string;
  /** 自定义类名 */
  customClass?: string;
  /** z-index 层级 */
  zIndex?: number;
  /** 是否在点击外部时关闭 */
  closeOnClickOutside?: boolean;
  /** 是否在按 ESC 时关闭 */
  closeOnEsc?: boolean;
  /** 标题 */
  title?: string;
  /** 自定义样式 */
  customStyle?: Record<string, string>;
}

export interface PopoverInstance {
  /** 唯一标识 */
  id: string;
  /** 目标元素 */
  target: HTMLElement;
  /** 配置选项 */
  options: PopoverOptions;
  /** 是否可见 */
  visible: boolean;
  /** X 坐标 */
  x: number;
  /** Y 坐标 */
  y: number;
  /** 显示定时器 */
  showTimer?: number | null;
  /** 隐藏定时器 */
  hideTimer?: number | null;
}

export interface PopoverAPI {
  /** 显示 Popover */
  show: (target: HTMLElement, options: PopoverOptions) => string;
  /** 隐藏指定 Popover */
  hide: (id: string) => void;
  /** 隐藏所有 Popover */
  hideAll: () => void;
  /** 更新 Popover */
  update: (id: string, options: Partial<PopoverOptions>) => void;
}

export interface PopoverDirectiveBinding {
  value: string | PopoverOptions;
  modifiers: {
    top?: boolean;
    bottom?: boolean;
    left?: boolean;
    right?: boolean;
    click?: boolean;
    hover?: boolean;
    focus?: boolean;
    dark?: boolean;
    light?: boolean;
    small?: boolean;
    medium?: boolean;
    large?: boolean;
    closable?: boolean;
  };
}
