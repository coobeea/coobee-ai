import type { App } from 'vue';

// 基础组件
export { default as BaseButton } from './BaseButton.vue';
export { default as CheckboxInput } from './CheckboxInput.vue';
export { default as RadioInput } from './RadioInput.vue';
export { default as SelectInput } from './SelectInput.vue';
export { default as SwitchInput } from './SwitchInput.vue';
export { default as TextInput } from './TextInput.vue';

// 预设按钮组件
export { default as DangerButton } from './DangerButton.vue';
export { default as GhostButton } from './GhostButton.vue';
export { default as OutlineButton } from './OutlineButton.vue';
export { default as PrimaryButton } from './PrimaryButton.vue';
export { default as SecondaryButton } from './SecondaryButton.vue';
export { default as TextButton } from './TextButton.vue';

// 类型导出
export type {
  BaseButtonProps,
  CommonButtonProps,
  DangerButtonProps,
  GhostButtonProps,
  OutlineButtonProps,
  PrimaryButtonProps,
  SecondaryButtonProps,
  SelectInputProps,
  SelectOption,
  TextButtonProps
} from './types';

// 导入所有组件用于插件注册
import BaseButton from './BaseButton.vue';
import CheckboxInput from './CheckboxInput.vue';
import DangerButton from './DangerButton.vue';
import GhostButton from './GhostButton.vue';
import OutlineButton from './OutlineButton.vue';
import PrimaryButton from './PrimaryButton.vue';
import RadioInput from './RadioInput.vue';
import SecondaryButton from './SecondaryButton.vue';
import SelectInput from './SelectInput.vue';
import SwitchInput from './SwitchInput.vue';
import TextButton from './TextButton.vue';
import TextInput from './TextInput.vue';

// 组件映射表
const componentMap = {
  BaseButton,
  CheckboxInput,
  RadioInput,
  SelectInput,
  SwitchInput,
  TextInput,
  DangerButton,
  GhostButton,
  OutlineButton,
  PrimaryButton,
  SecondaryButton,
  TextButton
};

// Vue 插件安装函数
const install = (app: App): void => {
  Object.entries(componentMap).forEach(([name, component]) => {
    app.component(name, component);
  });
};

// 默认导出插件
export default {
  install
};
