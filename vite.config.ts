import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    return {
      plugins: [react()],
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          '/api': { target: 'http://localhost:3002', changeOrigin: true }
        }
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
