import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import './styles.css';

// devtools easter egg: a wrench, run-length encoded (even runs are spaces, odd
// runs are '#'), rebuilt line by line and logged as monospace pre-formatted art.
(() => {
   const rows = [
      [39, 6],
      [37, 7],
      [27, 1, 7, 7],
      [17, 17, 1, 6, 8, 2],
      [13, 21, 1, 8, 3, 5],
      [10, 9, 16, 10, 1, 5],
      [8, 7, 19, 13, 1, 2],
      [6, 7, 20, 15],
      [5, 5, 15, 5, 2, 13],
      [4, 5, 15, 8, 2, 6, 6, 5],
      [3, 5, 12, 4, 1, 10, 1, 1, 10, 5],
      [2, 5, 11, 8, 1, 10, 11, 5],
      [1, 5, 13, 20, 9, 5],
      [1, 4, 11, 4, 1, 2, 1, 17, 8, 5],
      [1, 4, 10, 7, 1, 1, 1, 7, 1, 10, 6, 5],
      [0, 5, 10, 9, 2, 4, 4, 8, 8, 4],
      [0, 5, 7, 14, 1, 2, 2, 11, 8, 4],
      [1, 4, 6, 14, 3, 1, 1, 11, 8, 5],
      [1, 4, 7, 9, 2, 17, 9, 5],
      [1, 5, 4, 5, 1, 5, 1, 6, 1, 10, 9, 5],
      [2, 4, 2, 9, 3, 7, 1, 10, 10, 4],
      [3, 1, 2, 10, 1, 21, 9, 5],
      [4, 10, 3, 9, 1, 10, 8, 6],
      [3, 2, 4, 4, 5, 7, 4, 8, 7, 5],
      [4, 2, 2, 3, 10, 6, 1, 10, 4, 6],
      [6, 2, 2, 5, 7, 6, 1, 17],
      [11, 9, 3, 5, 2, 14],
      [14, 27],
      [18, 19],
   ];
   let art = '';
   for (const runs of rows) {
      let line = '';
      for (let i = 0; i < runs.length; i++) {
         line += (i % 2 === 0 ? ' ' : '#').repeat(runs[i]);
      }
      art += line + '\n';
   }
   // eslint-disable-next-line no-console
   console.log('%c' + art, 'font-family: monospace; line-height: 1em; white-space: pre;');
})();

createRoot(document.getElementById('root')!).render(
   <StrictMode>
      <App />
   </StrictMode>
);
