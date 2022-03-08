import { createContext, useContext } from 'react';
import { useFilteredPullsState, FilterFunction, FilterFunctionSetter } from './filtered-pulls-state';
import { Pull } from '../pull';

interface PullContextProps {
   // Array of pulls passing the filter function
   pulls: Pull[];
   // Changes the filter function
   setFilter: FilterFunctionSetter;
}

const defaultProps = {
   pulls: [],
   // Default implementation is a no-op, just so there's
   // something there until the provider is used
   setFilter: (filter: FilterFunction) => filter,
}
export const PullsContext = createContext<PullContextProps>(defaultProps);

export function usePulls(): Pull[] {
   return useContext(PullsContext).pulls;
}

export function useSetFilter(): FilterFunctionSetter {
   return useContext(PullsContext).setFilter;
}

export const PullsProvider = function({children}: {children: React.ReactNode}) {
   const [pulls, setFilter] = useFilteredPullsState();
   return (<PullsContext.Provider value={{pulls, setFilter}}>
      {children}
   </PullsContext.Provider>);
}