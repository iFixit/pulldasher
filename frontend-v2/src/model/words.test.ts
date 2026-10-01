import { describe, expect, it } from 'vitest';
import { andList } from './words';

describe('andList', () => {
   it('joins names the way a sentence does', () => {
      expect(andList([])).toBe('');
      expect(andList(['dana'])).toBe('dana');
      expect(andList(['dana', 'sam'])).toBe('dana and sam');
      expect(andList(['dana', 'sam', 'lee'])).toBe('dana, sam and lee');
   });
});
