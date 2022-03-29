import { useState } from 'react';
import { Pull } from  '../pull';

export type FilterFunction = (pull: Pull) => boolean;
export type FilterFunctionSetter = (filterName:string, filter:FilterFunction|null) => void;
// Map of human name to filter functions
type Filters = Record<string, FilterFunction>;
type ReturnType = [Pull[], FilterFunctionSetter];

const defaultFilters = {
   'default': (pull: Pull) => pull.isOpen()
}

/**
 * Wrapper around an array of pulls that allows multiple filters to be
 * specified.
 * setFilter(name, func) will *remove* the filter if func is null
 */
export function useFilteredPullsState(pulls: Pull[]): ReturnType {
   const [filters, setFilter] = useState<Filters>(defaultFilters);
   return [
      filterPulls(pulls, filters),
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

function filterPulls(pulls: Pull[], filters: Filters): Pull[] {
   return Object.values(filters).reduce((pulls, filter) => pulls.filter(filter), pulls)
}
