import { useState } from 'react';
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
   return [
      markFilteredPulls(pulls, filters),
      (filterName:string, filter:FilterFunction|null) => {
         if (filter) {
            filters[filterName] = filter;
         } else {
            delete filters[filterName];
         }
         setTimeout(() => setFilter({...filters}), 0);
      }
   ];
}

function markFilteredPulls(pulls: Pull[], filters: Filters): Pull[] {
   const filterArray = Object.values(filters);
   const combinedFilter = (pull: Pull): boolean => filterArray.every((filter) => filter(pull));
   return pulls.map((pull) => {
      pull.show = combinedFilter(pull);
      return pull;
   });
}
