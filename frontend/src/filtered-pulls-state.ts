import { useState } from 'react';
import { usePullsState } from './pulls-state';
import { Pull } from  './pull';

export type FilterFunction = (pull: Pull) => boolean;
export type FilterFunctionSetter = (filter: FilterFunction|null) => void;
export interface FilterProps {
   filter: FilterFunction
}

const defaultFilter = (pull: Pull) => !!pull;

/**
 * Wrapper around usePullsState that provides filtering
 */
export function useFilteredPullsState(): [Pull[], FilterFunctionSetter] {
   const [{filter}, setFilter] = useState<FilterProps>({filter: defaultFilter});
   return [
      usePullsState().filter(filter),
      (filter: FilterFunction) => setFilter({filter: filter || defaultFilter}),
   ];
}
