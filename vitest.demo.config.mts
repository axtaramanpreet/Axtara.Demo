import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Runs the demo-fund script, not a test suite: `npm run demo:reset`.
 *
 * It goes through Vitest only because Vitest already resolves the `@/` imports
 * the app's own code uses, so the script can call that code rather than a copy
 * of it — without adding a dependency to run one TypeScript file.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['scripts/demo/*.demo.ts'],
    testTimeout: 120_000,
  },
});
