/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// GitHub Pages serves the site at https://<user>.github.io/spin-arena/.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/spin-arena/' : '/',
  server: { port: 5211 },
  preview: { port: 5211 },
  test: { include: ['tests/**/*.test.ts'] },
}));
