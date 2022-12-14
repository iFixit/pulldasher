import { useState, useCallback } from 'react';
import { Pull } from  '../pull';

export type FilterFunction = (pull: Pull) => boolean;
export type FilterFunctionSetter = (filterName:string, filter:FilterFunction|null) => void;
// Map of human name to filter functions
type Filters = Record<string, FilterFunction>;
type ReturnType = [Pull[], FilterFunctionSetter];

/**
 * Wrapper around an array of pulls that allows multiple filters to be
 * specified.
 * setFilter(name, func) will *remove* the filter if func is null
 */
export function useFilteredPullsState(pulls: Pull[]): ReturnType {
   const [filters, setFilter] = useState<Filters>({});
   const replaceNamedFilter = useCallback(
      (filterName:string, filter:FilterFunction|null) => {
         // Use the functional form of `setState()` so we can base our new
         // value on the previous one.
         setFilter((currentFilters) => {
            if (filter) {
               currentFilters[filterName] = filter;
            } else {
               delete currentFilters[filterName];
            }
            return {...currentFilters};
         });
      },
      []
   );

   return [
      filterPulls(pulls, filters),
      replaceNamedFilter,
   ];
}

function filterPulls(pulls: Pull[], filters: Filters): Pull[] {
   return Object.values(filters).reduce((pulls, filter) => pulls.filter(filter), pulls)
}
