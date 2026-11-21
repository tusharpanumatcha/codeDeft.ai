import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
export default defineConfig({
  base: '/',
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { outDir: 'dist' },
  // The dashboard imports the shared protocol package from ../../packages/protocol/src.
  server: { port: 5173, fs: { allow: ['../..'] }, proxy: { '/api': 'http://127.0.0.1:4317' } },
  test: { environment: 'jsdom', include: ['tests/**/*.test.{ts,tsx}'], restoreMocks: true }
} as Parameters<typeof defineConfig>[0]);
