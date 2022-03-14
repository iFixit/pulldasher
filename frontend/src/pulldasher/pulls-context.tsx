import { createContext, useContext } from 'react';
import { useFilteredPullsState, FilterFunction, FilterFunctionSetter } from './filtered-pulls-state';
import { useSortedPullsState, CompareFunction, CompareFunctionSetter } from './sorted-pulls-state';
import { usePullsState } from './pulls-state';
import { Pull } from '../pull';

interface PullContextProps {
   // Array of pulls passing the filter function
   pulls: Pull[];
   // Changes the filter function
   setFilter: FilterFunctionSetter;
   // Changes the compare function for sorting
   setCompare: CompareFunctionSetter;
}

const defaultProps = {
   pulls: [],
   // Default implementation is a no-op, just so there's
   // something there until the provider is used
   setFilter: (filter: FilterFunction) => filter,
   setCompare: (compare: CompareFunction) => compare,
}
export const PullsContext = createContext<PullContextProps>(defaultProps);

export function usePulls(): Pull[] {
   return useContext(PullsContext).pulls;
}

export function useSetFilter(): FilterFunctionSetter {
   return useContext(PullsContext).setFilter;
}

export function useSetCompare(): CompareFunctionSetter {
   return useContext(PullsContext).setCompare;
}

export const PullsProvider = function({children}: {children: React.ReactNode}) {
   const unfilteredPulls = usePullsState();
   const [filteredPulls, setFilter] = useFilteredPullsState(unfilteredPulls);
   const [sortedPulls, setCompare] = useSortedPullsState(filteredPulls);
   return (<PullsContext.Provider value={{pulls: sortedPulls, setFilter, setCompare}}>
      {children}
   </PullsContext.Provider>);
}
