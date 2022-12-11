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
   // Set of open pulls passing the filter function
   filteredOpenPulls: Set<Pull>;
   // Changes the filter function
   setFilter: FilterFunctionSetter;
}

const defaultProps = {
   allPulls: [],
   allOpenPulls: [],
   filteredOpenPulls: new Set<Pull>(),
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

export function useFilteredOpenPulls(): Set<Pull> {
   return useContext(PullsContext).filteredOpenPulls;
}

export function useSetFilter(): FilterFunctionSetter {
   return useContext(PullsContext).setFilter;
}

export const PullsProvider = function({children}: {children: React.ReactNode}) {
   const unfilteredPulls = usePullsState();
   const [filteredPulls, setFilter] = useFilteredPullsState(unfilteredPulls);
   const openPulls = unfilteredPulls.filter(isOpen);
   const contextValue = {
      filteredOpenPulls: new Set(filteredPulls.filter(isOpen)),
      allOpenPulls: openPulls.sort(defaultCompare),
      allPulls: unfilteredPulls,
      setFilter
   };
   return (<PullsContext.Provider value={contextValue}>
      {children}
   </PullsContext.Provider>);
}

const isOpen = (pull: Pull) => pull.isOpen();
