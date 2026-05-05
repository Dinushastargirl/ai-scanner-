import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        'node-fetch': path.resolve(__dirname, './src/empty.ts'),
        'isomorphic-fetch': path.resolve(__dirname, './src/empty.ts'),
        'cross-fetch': path.resolve(__dirname, './src/empty.ts'),
        'whatwg-fetch': path.resolve(__dirname, './src/empty.ts'),
        'formdata-polyfill': path.resolve(__dirname, './src/empty.ts'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
