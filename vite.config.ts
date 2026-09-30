/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// GitHub Pages serves the site at https://<user>.github.io/spin-arena/.
// The Android app (Capacitor) serves the build from its own root: `vite build --mode android`.
export default defineConfig(({ command, isPreview, mode }) => ({
  base: mode === 'android' ? './' : command === 'build' || isPreview ? '/spin-arena/' : '/',
  server: { port: 5211 },
  preview: { port: 5211 },
  test: { include: ['tests/**/*.test.ts'] },
}));
