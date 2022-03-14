import { useState } from 'react';
import { Pull } from  '../pull';

export type FilterFunction = (pull: Pull) => boolean;
export type FilterFunctionSetter = (filter: FilterFunction|null) => void;
export interface FilterProps {
   filter: FilterFunction
}

type ReturnType = [Pull[], FilterFunctionSetter];

const defaultFilter = (pull: Pull) => !!pull;

/**
 * Wrapper around an array of pulls that provides filtering
 */
export function useFilteredPullsState(pulls: Pull[]): ReturnType {
   const [{filter}, setFilter] = useState<FilterProps>({filter: defaultFilter});
   return [
      pulls.filter(filter),
      (filter: FilterFunction) => {
         setTimeout(() => setFilter({filter: filter || defaultFilter}), 0);
      }
   ];
}
