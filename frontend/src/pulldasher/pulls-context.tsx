import { createContext, useContext } from 'react';
import { useFilteredPullsState, FilterFunction, FilterFunctionSetter } from './filtered-pulls-state';
import { usePullsState } from './pulls-state';
import { Pull } from '../pull';
import { getUser } from "../page-context";

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
   const unfilteredPulls = usePullsState();
   const [filteredPulls, setFilter] = useFilteredPullsState(unfilteredPulls);
   const sortedPulls = filteredPulls.sort(defaultSort);
   return (<PullsContext.Provider value={{pulls: sortedPulls, setFilter}}>
      {children}
   </PullsContext.Provider>);
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
