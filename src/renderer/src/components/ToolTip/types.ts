export interface ToolTipOptions {
  content: string;
  placement?:
    | 'top'
    | 'bottom'
    | 'left'
    | 'right'
    | 'top-start'
    | 'top-end'
    | 'bottom-start'
    | 'bottom-end'
    | 'left-start'
    | 'left-end'
    | 'right-start'
    | 'right-end';
  trigger?: 'hover' | 'click' | 'focus' | 'manual';
  delay?: number;
  hideDelay?: number;
  disabled?: boolean;
  arrow?: boolean;
  theme?: 'dark' | 'light';
  maxWidth?: string;
  offset?: number;
  zIndex?: number;
  persistent?: boolean; // 是否持久显示，不会因为鼠标移出而隐藏
  html?: boolean; // 是否支持 HTML 内容
}

export interface ToolTipInstance extends ToolTipOptions {
  id: string;
  visible: boolean;
  targetElement?: HTMLElement;
  x?: number;
  y?: number;
}

export interface ToolTipAPI {
  show: (target: HTMLElement, options: ToolTipOptions) => string;
  hide: (id: string) => void;
  hideAll: () => void;
  update: (id: string, options: Partial<ToolTipOptions>) => void;
  forceHideByTarget: (target: HTMLElement) => void;
  forceHideAll: () => void;
}

export interface ToolTipDirectiveBinding {
  value: string | ToolTipOptions;
  modifiers: {
    top?: boolean;
    bottom?: boolean;
    left?: boolean;
    right?: boolean;
    click?: boolean;
    focus?: boolean;
    dark?: boolean;
    light?: boolean;
  };
}
