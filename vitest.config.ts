import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.tsx'],
    testTimeout: 15000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
