import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Served by the express app at / (see app.js); the dev server proxies
// /token and the socket back to a locally running pulldasher backend.
export default defineConfig({
   plugins: [react(), tailwindcss()],
   server: {
      proxy: {
         '/token': 'http://localhost:3000',
         '/socket.io': { target: 'http://localhost:3000', ws: true },
         '/stats-history': 'http://localhost:3000',
      },
   },
});
