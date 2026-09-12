import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // Relative base so a build can be dropped onto any static host or subpath.
  base: './',
  plugins: [vue()],
  resolve: {
    // Vite resolves a root-absolute alias against the project root.
    alias: { '@': '/src' }
  },
  build: { target: 'es2022' }
})
