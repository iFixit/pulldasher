import { isIterating, weightRank, type DerivedPull } from './status';

/** lightest first; actively-iterating pulls sink (demoted, never hidden) */
export function crSort(pulls: DerivedPull[]): DerivedPull[] {
   return [...pulls].sort(
      (a, b) =>
         Number(isIterating(a.data)) - Number(isIterating(b.data)) ||
         weightRank(a.weight) - weightRank(b.weight) ||
         (a.data.additions ?? 0) +
            (a.data.deletions ?? 0) -
            ((b.data.additions ?? 0) + (b.data.deletions ?? 0))
   );
}
