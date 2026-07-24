import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// eslint-import-resolver-node can't follow exports-only packages (no
// "main"/"module" fallback); tsc and vite both resolve this fine.
// eslint-disable-next-line import/no-unresolved
import tailwindcss from '@tailwindcss/vite';

// Served by the express app at / (see app.js); the dev server proxies
// /token and the socket back to a locally running pulldasher backend.
export default defineConfig({
   plugins: [react(), tailwindcss()],
   server: {
      // the derive/CI model lives in ../shared (imported by both this app and
      // the pulldasher backend); let the dev server read one level up
      fs: { allow: ['..'] },
      proxy: {
         '/token': 'http://localhost:3000',
         '/socket.io': { target: 'http://localhost:3000', ws: true },
         '/stats-history': 'http://localhost:3000',
         '/user-names': 'http://localhost:3000',
      },
   },
});
