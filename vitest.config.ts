import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/main/ai/**/__tests__/**/*.test.ts'],
    // 自动加载 .env 文件中的环境变量
    env: {
      file: '.env'
    },
    coverage: {
      provider: 'v8',
      include: ['src/main/ai/**/*.ts'],
      exclude: ['src/main/ai/**/__tests__/**', 'src/main/ai/**/index.ts']
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
