import { lazy, Suspense, type ReactNode } from 'react';

// Recharts is the heaviest thing on the board, so it loads only when a
// Projects view that charts is opened: one chunk for all of the charts.
const charts = () => import('./charts');
export const BacklogFlowChart = lazy(() => charts().then(m => ({ default: m.BacklogFlowChart })));
export const ProjectBars = lazy(() => charts().then(m => ({ default: m.ProjectBars })));
export const PeopleBars = lazy(() => charts().then(m => ({ default: m.PeopleBars })));
export const AllocationChart = lazy(() => charts().then(m => ({ default: m.AllocationChart })));
export const SplitWeeksChart = lazy(() => charts().then(m => ({ default: m.SplitWeeksChart })));

/** Holds a chart's space while its chunk loads, so nothing below it jumps. */
export function ChartSlot({ height, children }: { height: number; children: ReactNode }) {
   return (
      <Suspense fallback={<div style={{ height }} aria-hidden />}>
         <div style={{ minHeight: height }}>{children}</div>
      </Suspense>
   );
}
