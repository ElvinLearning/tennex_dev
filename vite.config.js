import { defineConfig } from 'vite';
import { apiMiddleware } from './server/api.js';

// Mount the agent API inside the dev server so `npm run dev` is the whole stack.
const tennexApi = {
  name: 'tennex-api',
  configureServer(server) {
    server.middlewares.use(apiMiddleware);
  },
  configurePreviewServer(server) {
    server.middlewares.use(apiMiddleware);
  },
};

export default defineConfig({
  plugins: [tennexApi],
  build: { chunkSizeWarningLimit: 900 }, // three.js is one big, happy chunk
  test: {
    environment: 'node',
  },
});
