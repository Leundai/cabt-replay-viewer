import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

const apiProxyTarget = process.env.CABT_API_PROXY_TARGET ?? 'http://localhost:8000';

export default defineConfig({
  define: {
    global: 'globalThis',
  },
  plugins: [svelte()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
});
