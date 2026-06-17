import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['tests/unit/**', 'node_modules/**'],
  },
});
