<template>
  <div class="space-y-2">
    <label v-if="label" :for="inputId" class="block text-sm font-medium text-foreground">
      {{ label }}
      <span v-if="required" class="text-red-500 ml-1">*</span>
    </label>

    <div class="relative">
      <!-- 输入框 -->
      <div class="relative">
        <input
          :id="inputId"
          :value="props.searchable && isOpen ? searchValue : displayValue"
          :placeholder="placeholder"
          :disabled="disabled"
          :readonly="readonly"
          :required="required"
          :class="inputClasses"
          class="w-full px-3 py-2 pr-10 border rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
          @input="handleInput"
          @focus="handleFocus"
          @blur="handleBlur"
          @keydown="handleKeydown" />

        <!-- 下拉箭头 -->
        <div class="absolute inset-y-0 right-0 pr-3 flex items-center">
          <button
            type="button"
            :disabled="disabled || readonly"
            class="p-1 rounded hover:bg-muted/50 transition-colors disabled:cursor-not-allowed"
            @click="handleArrowClick">
            <i
              :class="[
                isOpen ? 'i-mdi-chevron-up' : 'i-mdi-chevron-down',
                error ? 'text-red-500' : 'text-muted-foreground'
              ]"
              class="w-4 h-4 transition-transform" />
          </button>
        </div>
      </div>

      <!-- 下拉选项列表 -->
      <div
        v-if="isOpen"
        class="absolute z-50 w-full mt-1 bg-background border border-border rounded-lg shadow-lg max-h-60 overflow-auto">
        <!-- 无选项提示 -->
        <div v-if="filteredOptions.length === 0" class="px-3 py-2 text-sm text-muted-foreground">
          {{ searchValue ? '无匹配选项' : '暂无选项' }}
        </div>

        <!-- 分组模式 -->
        <template v-if="grouped && filteredOptions.length > 0 && 'options' in filteredOptions[0]">
          <div v-for="group in filteredOptions" :key="group.label" class="group-container">
            <!-- 分组标题 -->
            <div class="px-3 py-2 text-xs font-semibold text-muted-foreground bg-muted/50 border-b border-border">
              {{ group.label }}
            </div>

            <!-- 分组选项 -->
            <div
              v-for="option in group.options"
              :key="option.value"
              :class="[
                'px-3 py-2 cursor-pointer transition-colors flex items-center justify-between group',
                'hover:bg-muted',
                option.disabled ? 'opacity-50 cursor-not-allowed' : '',
                isSelected(option.value) ? 'bg-primary/5 text-primary' : 'text-foreground'
              ]"
              @click="!option.disabled && selectOption(option)">
              <div class="flex items-center flex-1">
                <!-- 选项图标 -->
                <i v-if="option.icon" :class="[option.icon, 'w-4 h-4 mr-2 text-muted-foreground']" />

                <div class="flex-1">
                  <div class="text-sm font-medium">{{ option.label }}</div>
                  <div v-if="option.description" class="text-xs text-muted-foreground">{{ option.description }}</div>
                </div>
              </div>

              <!-- 删除按钮 -->
              <button
                v-if="allowDelete && !option.disabled"
                class="opacity-0 group-hover:opacity-100 ml-2 p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/20 text-red-500 transition-opacity"
                @click.stop="deleteOption(option)"
                @mousedown.prevent>
                <i class="i-mdi-close w-4 h-4" />
              </button>

              <!-- 选中图标 -->
              <i
                v-if="isSelected(option.value)"
                class="i-mdi-check w-4 h-4 text-primary ml-2"
                :class="{ 'mr-8': allowDelete }" />
            </div>
          </div>
        </template>

        <!-- 非分组模式 -->
        <template v-else>
          <div
            v-for="(option, index) in filteredOptions as SelectOption[]"
            :key="option.value"
            :class="[
              'px-3 py-2 cursor-pointer transition-colors flex items-center justify-between group',
              highlightedIndex === index ? 'bg-primary/10' : 'hover:bg-muted',
              option.disabled ? 'opacity-50 cursor-not-allowed' : '',
              isSelected(option.value) ? 'bg-primary/5 text-primary' : 'text-foreground'
            ]"
            @click="!option.disabled && selectOption(option)"
            @mouseenter="highlightedIndex = index">
            <div class="flex items-center flex-1">
              <!-- 选项图标 -->
              <i v-if="option.icon" :class="[option.icon, 'w-4 h-4 mr-2 text-muted-foreground']" />

              <div class="flex-1">
                <div class="text-sm font-medium">{{ option.label }}</div>
                <div v-if="option.description" class="text-xs text-muted-foreground">{{ option.description }}</div>
              </div>
            </div>

            <!-- 删除按钮 -->
            <button
              v-if="allowDelete && !option.disabled"
              class="opacity-0 group-hover:opacity-100 ml-2 p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/20 text-red-500 transition-opacity"
              @click.stop="deleteOption(option)"
              @mousedown.prevent>
              <i class="i-mdi-close w-4 h-4" />
            </button>

            <!-- 选中图标 -->
            <i
              v-if="isSelected(option.value)"
              class="i-mdi-check w-4 h-4 text-primary ml-2"
              :class="{ 'mr-8': allowDelete }" />
          </div>
        </template>
      </div>
    </div>

    <!-- 错误信息 -->
    <p v-if="error" class="text-sm text-red-500">{{ error }}</p>

    <!-- 帮助文本 -->
    <p v-if="help && !error" class="text-sm text-muted-foreground">{{ help }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import type { SelectInputProps, SelectOption, SelectOptionGroup } from './types';

interface Emits {
  (e: 'update:modelValue', value: string | number | (string | number)[] | undefined): void;
  (e: 'change', value: string | number | (string | number)[] | undefined): void;
  (e: 'focus', event: FocusEvent): void;
  (e: 'blur', event: FocusEvent): void;
  (e: 'delete', option: SelectOption): void;
  (e: 'search', query: string): void;
}

const props = withDefaults(defineProps<SelectInputProps>(), {
  size: 'md',
  multiple: false,
  searchable: true,
  allowDelete: false,
  placeholder: '请选择',
  noDataText: '暂无选项'
});

const emit = defineEmits<Emits>();

const inputId = ref(`select-${Math.random().toString(36).slice(2, 11)}`);
const isOpen = ref(false);
const searchValue = ref('');
const highlightedIndex = ref(-1);

// 将选项展平，无论是否分组
const flatOptions = computed(() => {
  if (props.grouped && Array.isArray(props.options) && props.options.length > 0 && 'options' in props.options[0]) {
    const groups = props.options as SelectOptionGroup[];
    return groups.flatMap((group) => group.options);
  }
  return props.options as SelectOption[];
});

// 计算输入框的显示值
const displayValue = computed(() => {
  if (!props.modelValue) return '';

  if (props.multiple) {
    const values = Array.isArray(props.modelValue) ? props.modelValue : [props.modelValue];
    const labels = values.map((value) => {
      const option = flatOptions.value.find((opt) => opt.value === value);
      return option?.label || value;
    });
    return labels.join(', ');
  } else {
    const option = flatOptions.value.find((opt) => opt.value === props.modelValue);
    return option?.label || '';
  }
});

// 过滤后的选项
const filteredOptions = computed(() => {
  if (!props.searchable || !searchValue.value) {
    return props.options;
  }

  const query = searchValue.value.toLowerCase();

  if (props.grouped && Array.isArray(props.options) && props.options.length > 0 && 'options' in props.options[0]) {
    const groups = props.options as SelectOptionGroup[];
    return groups
      .map((group) => ({
        ...group,
        options: group.options.filter(
          (option) => option.label.toLowerCase().includes(query) || option.description?.toLowerCase().includes(query)
        )
      }))
      .filter((group) => group.options.length > 0);
  }

  const options = props.options as SelectOption[];
  return options.filter(
    (option) => option.label.toLowerCase().includes(query) || option.description?.toLowerCase().includes(query)
  );
});

// 输入框样式
const inputClasses = computed(() => {
  const classes: string[] = [];

  // 基础样式
  classes.push('bg-background border-border text-foreground');

  // 尺寸
  switch (props.size) {
    case 'sm':
      classes.push('px-2 py-1 text-sm');
      break;
    case 'lg':
      classes.push('px-4 py-3 text-lg');
      break;
    default:
      classes.push('px-3 py-2');
  }

  // 错误状态
  if (props.error) {
    classes.push('border-red-500 focus:border-red-500 focus:ring-red-500/20');
  } else {
    classes.push('border-gray-300 dark:border-gray-600');
  }

  return classes.join(' ');
});

// 检查选项是否被选中
const isSelected = (value: string | number): boolean => {
  if (!props.modelValue) return false;

  if (props.multiple) {
    const values = Array.isArray(props.modelValue) ? props.modelValue : [props.modelValue];
    return values.includes(value);
  } else {
    return props.modelValue === value;
  }
};

// 处理输入
const handleInput = (event: Event) => {
  const target = event.target as HTMLInputElement;
  searchValue.value = target.value;

  if (!isOpen.value) {
    isOpen.value = true;
  }

  highlightedIndex.value = -1;
  emit('search', searchValue.value);
};

// 处理焦点
const handleFocus = (event: FocusEvent) => {
  if (!props.disabled && !props.readonly) {
    isOpen.value = true;
    if (props.searchable) {
      searchValue.value = '';
    }
  }
  emit('focus', event);
};

// 处理箭头点击
const handleArrowClick = () => {
  if (props.disabled || props.readonly) return;

  isOpen.value = !isOpen.value;

  if (isOpen.value && props.searchable) {
    searchValue.value = '';
  }
};

// 处理失焦
const handleBlur = (event: FocusEvent) => {
  // 延迟关闭下拉框，以便处理点击选项
  setTimeout(() => {
    isOpen.value = false;
    if (props.searchable) {
      searchValue.value = '';
    }
    highlightedIndex.value = -1;
  }, 150);

  emit('blur', event);
};

// 处理键盘事件
const handleKeydown = (event: KeyboardEvent) => {
  if (props.disabled || props.readonly) return;

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      if (!isOpen.value) {
        isOpen.value = true;
      } else if (!props.grouped) {
        const options = filteredOptions.value as SelectOption[];
        highlightedIndex.value = Math.min(highlightedIndex.value + 1, options.length - 1);
      }
      break;

    case 'ArrowUp':
      event.preventDefault();
      if (isOpen.value && !props.grouped) {
        highlightedIndex.value = Math.max(highlightedIndex.value - 1, -1);
      }
      break;

    case 'Enter':
      event.preventDefault();
      if (isOpen.value && highlightedIndex.value >= 0) {
        // 在非分组模式下才支持键盘选择
        if (!props.grouped) {
          const options = filteredOptions.value as SelectOption[];
          const option = options[highlightedIndex.value];
          if (option && !option.disabled) {
            selectOption(option);
          }
        }
      } else if (!isOpen.value) {
        isOpen.value = true;
      }
      break;

    case 'Escape':
      event.preventDefault();
      isOpen.value = false;
      highlightedIndex.value = -1;
      break;
  }
};

// 选择选项
const selectOption = (option: SelectOption) => {
  if (option.disabled) return;

  let newValue: string | number | (string | number)[] | undefined;

  if (props.multiple) {
    const currentValues = Array.isArray(props.modelValue)
      ? [...props.modelValue]
      : props.modelValue
        ? [props.modelValue]
        : [];
    const index = currentValues.indexOf(option.value);

    if (index > -1) {
      currentValues.splice(index, 1);
    } else {
      currentValues.push(option.value);
    }

    newValue = currentValues;
  } else {
    newValue = option.value;
    isOpen.value = false;
  }

  emit('update:modelValue', newValue);
  emit('change', newValue);

  if (props.searchable) {
    searchValue.value = '';
  }
  highlightedIndex.value = -1;
};

// 删除选项
const deleteOption = (option: SelectOption) => {
  emit('delete', option);
};

// 监听modelValue变化，更新显示
watch(
  () => props.modelValue,
  () => {
    if (props.searchable && !isOpen.value) {
      searchValue.value = '';
    }
  }
);

// 监听filteredOptions变化，重置高亮索引
watch(filteredOptions, () => {
  highlightedIndex.value = -1;
});
</script>
