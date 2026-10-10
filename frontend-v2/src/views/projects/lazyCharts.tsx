import { lazy, Suspense, type ReactNode } from 'react';

// Recharts is the heaviest thing on the board, so it loads only when a
// Projects view that charts is opened: one chunk for all of the charts.
const charts = () => import('./charts');
export const OpenPrsChart = lazy(() => charts().then(m => ({ default: m.OpenPrsChart })));
export const FlowWeeksChart = lazy(() => charts().then(m => ({ default: m.FlowWeeksChart })));
export const StripsChart = lazy(() => charts().then(m => ({ default: m.StripsChart })));
export const SplitWeeksChart = lazy(() => charts().then(m => ({ default: m.SplitWeeksChart })));
export const BucketChart = lazy(() => charts().then(m => ({ default: m.BucketChart })));

/** Holds a chart's space while its chunk loads, so nothing below it jumps. */
export function ChartSlot({ height, children }: { height: number; children: ReactNode }) {
   return (
      <Suspense fallback={<div style={{ height }} aria-hidden />}>
         <div style={{ minHeight: height }}>{children}</div>
      </Suspense>
   );
}
