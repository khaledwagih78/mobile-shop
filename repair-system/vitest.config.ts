import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['./tests/db/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // كل ملف اختبار له قاعدة بيانات مستقلة، فينفع يشتغلوا بالتوازي
    fileParallelism: true,
  },
});
