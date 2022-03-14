import { useState } from 'react';
import { getUser } from "../page-context";
import { Pull } from  '../pull';

export type CompareFunction = (a: Pull, b: Pull) => number
export type CompareFunctionSetter = (compare: CompareFunction|null) => void;
export interface CompareProps {
   compare: CompareFunction | null
}

type ReturnType = [Pull[], CompareFunctionSetter];

/**
 * Wrapper around an array of pulls that provides sorting
 */
export function useSortedPullsState(pulls: Pull[]): ReturnType {
   const [{compare}, setCompare] = useState<CompareProps>({compare: defaultSort});
   return [
      compare ? pulls.sort(compare) : pulls,
      (compare: CompareFunction) => {
         setTimeout(() => setCompare({compare}), 0);
      }
   ];
}

function defaultSort(a: Pull, b: Pull): number {
   return (
    // My pulls above pulls that aren't mind
    compareBool(a.isMine(), b.isMine()) ||
    // Pulls I have to CR/QA above those I don't
    compareBool(a.hasOutdatedSig(getUser()), b.hasOutdatedSig(getUser())) ||
    // Pulls I haven't touched vs those I have already CRed
    compareBool(!a.hasCurrentSig(getUser()), !b.hasCurrentSig(getUser()))
   );
}

function compareBool(a: boolean, b: boolean): number {
   return a == b ? 0 : (a ? -1 : 1);
}
