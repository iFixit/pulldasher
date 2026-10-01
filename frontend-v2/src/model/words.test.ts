import { describe, expect, it } from 'vitest';
import { andList, devDays } from './words';

describe('andList', () => {
   it('joins names the way a sentence does', () => {
      expect(andList([])).toBe('');
      expect(andList(['dana'])).toBe('dana');
      expect(andList(['dana', 'sam'])).toBe('dana and sam');
      expect(andList(['dana', 'sam', 'lee'])).toBe('dana, sam and lee');
   });
});

describe('devDays', () => {
   it('keeps a tenth under 10 days and whole days above', () => {
      expect(devDays(2.46)).toBe(2.5);
      expect(devDays(12.46)).toBe(12);
   });
});
