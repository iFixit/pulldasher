// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { Fold } from './Lane';

// React's act() warns unless the environment says it's a test
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function band(long: boolean) {
   const host = document.createElement('div');
   document.body.append(host);
   const root = createRoot(host);
   act(() =>
      root.render(
         <Fold label="A very long initiative name" count={5} detail={<span>owned by dana</span>} long={long}>
            <p>rows</p>
         </Fold>
      )
   );
   const summary = host.querySelector('summary') as HTMLElement;
   const name = [...summary.querySelectorAll('span')].find(
      s => s.textContent === 'A very long initiative name'
   ) as HTMLElement;
   const detail = [...summary.querySelectorAll('span')].find(
      s => s.textContent === 'owned by dana' && s.parentElement === summary
   ) as HTMLElement;
   act(() => root.unmount());
   host.remove();
   return { summary, name, detail };
}

describe('a band whose name runs long', () => {
   it('ends its name in an ellipsis, keeps its count, and puts its detail on its own line on a phone', () => {
      const { summary, name, detail } = band(true);
      expect(name.className).toContain('truncate');
      expect(name.nextElementSibling?.textContent).toContain('· 5');
      expect(summary.className).toContain('flex-wrap');
      expect(detail.className).toContain('basis-full');
      expect(detail.className).toContain('sm:basis-auto');
   });

   it('is laid out as before when it isn’t long', () => {
      const { name, detail } = band(false);
      expect(name.className).not.toContain('truncate');
      expect(detail.className).toContain('ml-auto');
      expect(detail.className).not.toContain('basis-full');
   });
});
