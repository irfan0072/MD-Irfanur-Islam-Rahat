import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import tailwindcss from '@tailwindcss/vite'

// Relative base so the build works on any static host or sub-folder.
export default defineConfig({
  base: './',
  plugins: [preact(), tailwindcss()],
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 1500,
  },
  worker: { format: 'es' },
})
