import { createContext, useContext } from 'react';
import { usePullsState } from './pulls-state';
import { Pull } from './pull';

interface PullContextProps {
   pulls: Pull[];
}

export const PullsContext = createContext<PullContextProps>({pulls:[]});

export function usePulls(): Pull[] {
   return useContext(PullsContext).pulls;
}

export const PullsProvider = function({children}) {
   const pulls: Pull[] = usePullsState();
   return (<PullsContext.Provider value={{pulls:pulls}}>
      {children}
   </PullsContext.Provider>);
}
