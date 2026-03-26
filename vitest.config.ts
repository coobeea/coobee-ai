import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'src/main/ai/**/__tests__/**/*.test.ts',
      'src/main/common/server/**/__tests__/**/*.test.ts',
      'src/main/gateway/__tests__/**/*.test.ts',
      'src/main/common/extension/__tests__/**/*.test.ts',
      'src/main/common/config/__tests__/**/*.test.ts',
      'src/main/common/middleware/__tests__/**/*.test.ts',
      'src/main/common/worker/**/__tests__/**/*.test.ts',
      'src/main/common/database/__tests__/**/*.test.ts',
      'src/main/common/ipc/__tests__/**/*.test.ts',
      'src/main/common/errors/__tests__/**/*.test.ts',
      'src/main/lifecycle/__tests__/**/*.test.ts',
      'src/main/terminal/__tests__/**/*.test.ts',
      'src/main/channels/__tests__/**/*.test.ts',
      'src/main/training/__tests__/**/*.test.ts',
      'src/main/insight/__tests__/**/*.test.ts',
      'src/renderer/**/__tests__/**/*.test.ts',
      'extensions/**/__tests__/**/*.test.ts'
    ],
    // 自动加载 .env 文件中的环境变量
    env: {
      file: '.env'
    },
    coverage: {
      provider: 'v8',
      include: [
        'src/main/ai/**/*.ts',
        'src/main/common/server/**/*.ts',
        'src/main/gateway/**/*.ts',
        'src/main/common/extension/**/*.ts',
        'src/main/common/config/**/*.ts',
        'src/main/common/middleware/**/*.ts',
        'src/main/common/database/**/*.ts',
        'src/main/common/ipc/**/*.ts',
        'src/main/common/errors/**/*.ts',
        'src/main/lifecycle/**/*.ts',
        'src/main/training/**/*.ts'
      ],
      exclude: [
        'src/main/ai/**/__tests__/**',
        'src/main/ai/**/index.ts',
        'src/main/common/server/__tests__/**',
        'src/main/gateway/__tests__/**',
        'src/main/common/extension/__tests__/**',
        'src/main/common/config/__tests__/**',
        'src/main/common/middleware/__tests__/**',
        'src/main/common/database/__tests__/**',
        'src/main/common/ipc/__tests__/**',
        'src/main/common/errors/__tests__/**',
        'src/main/lifecycle/__tests__/**',
        'src/main/training/__tests__/**'
      ]
    },
    alias: [
      { find: '@/config', replacement: resolve(__dirname, 'src/renderer/src/config.ts') },
      { find: '@/plugins', replacement: resolve(__dirname, 'src/renderer/src/plugins') },
      { find: '@/composables', replacement: resolve(__dirname, 'src/renderer/src/composables') },
      { find: '@main', replacement: resolve(__dirname, 'src/main') },
      { find: '@shared', replacement: resolve(__dirname, 'src/shared') },
      { find: '@', replacement: resolve(__dirname, 'src') }
    ],
    // 报告器：verbose 输出 + JUnit XML
    reporters: ['verbose', 'junit'],
    outputFile: {
      junit: './test-results/junit.xml'
    }
  }
});
