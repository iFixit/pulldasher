import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Served by the express app at /v2 (see app.js); the dev server proxies
// /token and the socket back to a locally running pulldasher backend.
export default defineConfig({
   base: '/v2/',
   plugins: [react(), tailwindcss()],
   server: {
      proxy: {
         '/token': 'http://localhost:3000',
         '/socket.io': { target: 'http://localhost:3000', ws: true },
      },
   },
});
