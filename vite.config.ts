import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: '/webGerber/',
  cacheDir: join(tmpdir(), 'vite-webgerber'),
  build: { chunkSizeWarningLimit: 1000, outDir: process.env.CI ? 'dist' : join(tmpdir(), 'webgerber-dist'), emptyOutDir: true },
  worker: { format: 'es' },
  test: { environment: 'node', exclude: ['node_modules/**', 'tests/e2e/**'] },
})
