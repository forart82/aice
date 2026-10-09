import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: './',
  server: {
    port: 3001,
    host: true,
    strictPort: false
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
    testTimeout: 300000,
    hookTimeout: 60000,
    teardownTimeout: 60000,
    pool: 'forks',
    poolOptions: {
      forks: {
        execArgv: ['--expose-gc']
      }
    }
  }
});

