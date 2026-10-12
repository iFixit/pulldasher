// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { landingIn, useRowKeys } from './useRowKeys';

// React's act() warns unless the environment says it's a test
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom draws nothing: every element counts as drawn here
const real = Element.prototype.getClientRects;
beforeAll(() => {
   Element.prototype.getClientRects = () => [{}] as unknown as DOMRectList;
});
afterAll(() => {
   Element.prototype.getClientRects = real;
});

/** Decide's kinds of row, as far as j and k can tell them apart. */
function Rows() {
   useRowKeys('[data-row]', '[data-lead]');
   return (
      <>
         <button id="header">Answer all</button>
         {/* a question: its answer */}
         <div data-row>
            <button>Akeneo</button>
            <button data-lead id="a">
               Reopen Catalog
            </button>
         </div>
         {/* Unsorted, nothing picked: File waits on the chooser */}
         <div data-row>
            <button id="b">Training periods</button>
            <select aria-label="File in" />
            <button data-lead disabled>
               File
            </button>
         </div>
         {/* an answer waiting on its chooser: Other answers leads */}
         <div data-row>
            <button>Grafana dashboards</button>
            <select aria-label="File in" />
            <button disabled>Plan it</button>
            <button data-lead id="c">
               Other answers
            </button>
         </div>
         {/* No project yet: Link waits on its project */}
         <div data-row>
            <button id="d">Visual regression checks</button>
            <select aria-label="Its project" />
            <button data-lead disabled>
               Link
            </button>
         </div>
         {/* a row with nothing to land on at all */}
         <div data-row>
            <span>Nothing to press</span>
         </div>
         {/* the last: one answer */}
         <div data-row>
            <button id="e-name">Ops runbooks</button>
            <button data-lead id="e">
               Keep not tracked
            </button>
         </div>
      </>
   );
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
   act(() => root?.unmount());
   host?.remove();
});

function mount() {
   host = document.createElement('div');
   document.body.append(host);
   const r = createRoot(host);
   root = r;
   act(() => r.render(<Rows />));
}

const press = (key: string) =>
   act(() => {
      (document.activeElement ?? document.body).dispatchEvent(
         new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      );
   });
const at = () => (document.activeElement as HTMLElement).id;

describe('j and k on Decide', () => {
   it('reach every row with j, landing on the first answer that can be pressed', () => {
      mount();
      const seen: string[] = [];
      for (let k = 0; k < 6; k++) {
         press('j');
         seen.push(at());
      }
      // an answer that's off is passed over for the row's name, never a
      // select (where j would pick an option); the empty row is stepped past;
      // past the last row it stays
      expect(seen).toEqual(['a', 'b', 'c', 'd', 'e', 'e']);
   });

   it('reach every row with k, from every row', () => {
      mount();
      for (const from of ['e', 'd', 'c', 'b']) {
         (document.getElementById(from) as HTMLElement).focus();
         press('k');
         expect(at()).toBe({ e: 'd', d: 'c', c: 'b', b: 'a' }[from]);
      }
      // from a row's other control, too
      (document.getElementById('e-name') as HTMLElement).focus();
      press('k');
      expect(at()).toBe('d');
   });

   it('start from outside the rows at the next one, or the last one before for k', () => {
      mount();
      (document.getElementById('header') as HTMLElement).focus();
      press('j');
      expect(at()).toBe('a');
      (document.getElementById('header') as HTMLElement).focus();
      // nothing above the header: k goes round to the last row
      press('k');
      expect(at()).toBe('e');
   });

   it('leave a select alone, so a letter picks an option there', () => {
      mount();
      const select = document.querySelector('select') as HTMLSelectElement;
      select.focus();
      press('j');
      expect(document.activeElement).toBe(select);
   });
});

describe('where j and k land in a row', () => {
   it('pass over an answer that says it’s off, and a field given a tabindex', () => {
      const row = document.createElement('div');
      row.innerHTML =
         '<button data-lead aria-disabled="true">File</button>' +
         '<select tabindex="0"></select><input tabindex="0">' +
         '<a href="#x" id="name">Store picker</a>';
      expect(landingIn(row, '[data-lead]')?.id).toBe('name');
   });
});
