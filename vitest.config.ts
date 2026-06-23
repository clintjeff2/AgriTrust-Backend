import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['tests/unit/sensors.test.ts', 'node_modules/**'],
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
