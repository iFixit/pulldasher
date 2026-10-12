import { describe, expect, it } from 'vitest';
import { chartWindow, previousRange, rangeDays, resolveRange } from './projectData';

// noon on 2026-09-29 where the test runs: presets count the reader's own days
const NOW = new Date(2026, 8, 29, 12).getTime() / 1000;

describe('resolveRange', () => {
   it('counts the last N days through today', () => {
      expect(resolveRange('30d', NOW)).toEqual({ start: '2026-08-31', end: '2026-09-29' });
      expect(resolveRange('7d', NOW)).toEqual({ start: '2026-09-23', end: '2026-09-29' });
   });

   it('covers the calendar presets an analytics tool offers', () => {
      expect(resolveRange('month', NOW)).toEqual({ start: '2026-09-01', end: '2026-09-29' });
      expect(resolveRange('last-month', NOW)).toEqual({ start: '2026-08-01', end: '2026-08-31' });
      expect(resolveRange('quarter', NOW)).toEqual({ start: '2026-07-01', end: '2026-09-29' });
      expect(resolveRange('last-quarter', NOW)).toEqual({
         start: '2026-04-01',
         end: '2026-06-30',
      });
      expect(resolveRange('ytd', NOW)).toEqual({ start: '2026-01-01', end: '2026-09-29' });
   });

   it('reaches back across a year boundary', () => {
      const jan = new Date(2027, 0, 10, 12).getTime() / 1000;
      expect(resolveRange('last-month', jan)).toEqual({ start: '2026-12-01', end: '2026-12-31' });
      expect(resolveRange('last-quarter', jan)).toEqual({
         start: '2026-10-01',
         end: '2026-12-31',
      });
   });

   it('takes a custom window the server would take, and nothing else', () => {
      expect(resolveRange('2026-09-01..2026-09-10', NOW)).toEqual({
         start: '2026-09-01',
         end: '2026-09-10',
      });
      expect(resolveRange('2026-09-10..2026-09-01', NOW)).toBeNull();
      expect(resolveRange('2020-01-01..2026-09-10', NOW)).toBeNull();
      expect(resolveRange('2026-02-30..2026-03-10', NOW)).toBeNull();
      expect(resolveRange('500d', NOW)).toBeNull();
      expect(resolveRange('soon', NOW)).toBeNull();
   });
});

describe('previousRange', () => {
   it('is the same number of days just before', () => {
      const range = { start: '2026-08-31', end: '2026-09-29' };
      expect(rangeDays(range)).toBe(30);
      expect(previousRange(range)).toEqual({ start: '2026-08-01', end: '2026-08-30' });
   });
});

describe('chartWindow', () => {
   it('stretches a short range back to 90 days and leaves a long one alone', () => {
      expect(chartWindow({ start: '2026-09-01', end: '2026-09-29' })).toEqual({
         start: '2026-07-02',
         end: '2026-09-29',
      });
      expect(chartWindow({ start: '2026-03-01', end: '2026-09-29' })).toEqual({
         start: '2026-03-01',
         end: '2026-09-29',
      });
   });
});
