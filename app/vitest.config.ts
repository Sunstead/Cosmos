import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    // Pure logic only: ring buffers, service derivation, formatting, URL
    // handling. Component rendering isn't covered.
    include: ['src/**/*.test.ts'],
  },
});
