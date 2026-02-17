import { defineConfig } from 'eslint/config';
import tseslint from '@electron-toolkit/eslint-config-ts';
import eslintConfigPrettier from 'eslint-config-prettier';
import eslintPluginVue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';

export default defineConfig(
  { ignores: ['**/node_modules', '**/dist', '**/out', 'scripts/**'] },
  tseslint.configs.recommended,
  eslintPluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true
        },
        extraFileExtensions: ['.vue'],
        parser: tseslint.parser
      }
    }
  },
  {
    files: ['**/*.{ts,mts,tsx,vue}'],
    rules: {
      'vue/require-default-prop': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/block-lang': [
        'error',
        {
          script: {
            lang: 'ts'
          }
        }
      ],
      // 允许下划线前缀的未使用变量（用于接口实现中的占位参数）
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ]
    }
  },
  // 从旧项目迁移的基础 UI 组件——放宽严格的返回类型要求
  {
    files: [
      'src/renderer/src/components/Message/**',
      'src/renderer/src/components/Confirm/**',
      'src/renderer/src/components/ToolTip/**',
      'src/renderer/src/components/Popover/**',
      'src/renderer/src/components/Popup/**',
      'src/renderer/src/components/Form/**',
      'src/renderer/src/components/OverlayMask/**',
      'src/renderer/src/components/LoadingOverlay.vue',
      'src/renderer/src/utils/ZIndexManager.ts'
    ],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn'
    }
  },
  eslintConfigPrettier
);
