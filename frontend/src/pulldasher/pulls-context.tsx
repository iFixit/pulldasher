import { createContext, useContext } from 'react';
import { useFilteredPullsState, FilterFunction, FilterFunctionSetter } from './filtered-pulls-state';
import { usePullsState } from './pulls-state';
import { Pull } from '../pull';
import { defaultCompare } from "./sort";

interface PullContextProps {
   // Unsorted array of all pulls (open + recently closed)
   allPulls: Pull[];
   // Sorted array of all open pulls (open)
   allOpenPulls: Pull[];
   // Set pf pulls passing the filter function
   pulls: Set<Pull>;
   // Changes the filter function
   setFilter: FilterFunctionSetter;
}

const defaultProps = {
   allPulls: [],
   allOpenPulls: [],
   pulls: new Set<Pull>(),
   // Default implementation is a no-op, just so there's
   // something there until the provider is used
   setFilter: (name:string, filter:FilterFunction) => filter,
}
const PullsContext = createContext<PullContextProps>(defaultProps);

export function useAllOpenPulls(): Pull[] {
   return useContext(PullsContext).allOpenPulls;
}

export function useAllPulls(): Pull[] {
   return useContext(PullsContext).allPulls;
}

export function usePulls(): Set<Pull> {
   return useContext(PullsContext).pulls;
}

export function useSetFilter(): FilterFunctionSetter {
   return useContext(PullsContext).setFilter;
}

export const PullsProvider = function({children}: {children: React.ReactNode}) {
   const unfilteredPulls = usePullsState();
   const [filteredPulls, setFilter] = useFilteredPullsState(unfilteredPulls);
   const openPulls = unfilteredPulls.filter(isOpen);
   const contextValue = {
      pulls: new Set(filteredPulls),
      allOpenPulls: openPulls.sort(defaultCompare),
      allPulls: unfilteredPulls,
      setFilter
   };
   return (<PullsContext.Provider value={contextValue}>
      {children}
   </PullsContext.Provider>);
}

const isOpen = (pull: Pull) => pull.isOpen();
