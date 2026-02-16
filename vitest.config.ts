import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/main/ai/**/__tests__/**/*.test.ts',
      'src/main/common/server/__tests__/**/*.test.ts',
      'src/main/gateway/__tests__/**/*.test.ts',
      'src/main/common/extension/__tests__/**/*.test.ts',
      'src/main/common/config/__tests__/**/*.test.ts',
      'src/main/common/middleware/__tests__/**/*.test.ts',
      'src/main/lifecycle/__tests__/**/*.test.ts'
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
        'src/main/lifecycle/**/*.ts'
      ],
      exclude: [
        'src/main/ai/**/__tests__/**',
        'src/main/ai/**/index.ts',
        'src/main/common/server/__tests__/**',
        'src/main/gateway/__tests__/**',
        'src/main/common/extension/__tests__/**',
        'src/main/common/config/__tests__/**',
        'src/main/common/middleware/__tests__/**',
        'src/main/lifecycle/__tests__/**'
      ]
    },
    alias: {
      '@': resolve(__dirname, 'src'),
      '@main': resolve(__dirname, 'src/main'),
      '@shared': resolve(__dirname, 'src/shared')
    },
    // 报告器：verbose 输出 + JUnit XML
    reporters: ['verbose', 'junit'],
    outputFile: {
      junit: './test-results/junit.xml'
    }
  }
})
