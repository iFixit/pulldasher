import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import './styles.css';

// eslint-disable-next-line no-console
console.log('%cpulldasher v2', 'color:#0071CE;font-weight:700', 'wrench in hand.');

createRoot(document.getElementById('root')!).render(
   <StrictMode>
      <App />
   </StrictMode>
);
