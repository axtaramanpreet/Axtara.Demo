import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // .tsx too: the notices toolbar decides which action to offer during
    // render, which is worth a test and cannot live in a .ts file.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
