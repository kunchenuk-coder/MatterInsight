import path from 'path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createSpeechToTextMiddleware } from './server/speechToText';
import { createUploadMiddleware } from './server/uploadHandler';
import { createGetUploadUrlMiddleware } from './server/getUploadUrlHandler';
import { createUploadAssetMiddleware } from './server/uploadAssetHandler';
import { createGetReadUrlMiddleware } from './server/getReadUrlHandler';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, __dirname, '');
    Object.assign(process.env, env);

    return {
      envDir: __dirname,
      envPrefix: 'VITE_',
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        {
          name: 'speech-to-text-api',
          configureServer(server) {
            server.middlewares.use(createSpeechToTextMiddleware());
          },
        },
        {
          name: 'image-upload-api',
          configureServer(server) {
            server.middlewares.use(createUploadMiddleware());
          },
        },
        {
          name: 'get-upload-url-api',
          configureServer(server) {
            server.middlewares.use(createGetUploadUrlMiddleware());
          },
        },
        {
          name: 'upload-asset-api',
          configureServer(server) {
            server.middlewares.use(createUploadAssetMiddleware());
          },
        },
        {
          name: 'get-read-url-api',
          configureServer(server) {
            server.middlewares.use(createGetReadUrlMiddleware());
          },
        },
      ],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
