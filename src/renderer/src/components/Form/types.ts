// 共用的按钮Props类型
export interface CommonButtonProps {
  size?: 'sm' | 'md' | 'lg';
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  leftIcon?: string;
  rightIcon?: string;
  icon?: string; // 仅图标模式使用
  label?: string;
  mode?: 'text' | 'icon' | 'text-icon'; // 按钮模式
}

// 基础按钮Props（包含variant）
export interface BaseButtonProps extends CommonButtonProps {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'text';
}

// 预设按钮Props（不包含variant，因为已经预设）
export type PrimaryButtonProps = CommonButtonProps;
export type SecondaryButtonProps = CommonButtonProps;
export type OutlineButtonProps = CommonButtonProps;
export type GhostButtonProps = CommonButtonProps;
export type DangerButtonProps = CommonButtonProps;
export type TextButtonProps = CommonButtonProps;

// Select组件选项类型
export interface SelectOption {
  label: string;
  value: string | number;
  description?: string;
  disabled?: boolean;
  icon?: string; // 添加图标支持
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

// 分组选项类型
export interface SelectOptionGroup {
  label: string;
  options: SelectOption[];
  disabled?: boolean;
}

// SelectInput组件Props类型
export interface SelectInputProps {
  modelValue?: string | number | (string | number)[];
  options: SelectOption[] | SelectOptionGroup[]; // 支持分组选项
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  readonly?: boolean;
  required?: boolean;
  error?: string;
  help?: string;
  size?: 'sm' | 'md' | 'lg';
  multiple?: boolean;
  searchable?: boolean;
  allowDelete?: boolean;
  noDataText?: string;
  grouped?: boolean; // 是否使用分组模式
}
