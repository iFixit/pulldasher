import { createContext, useContext } from 'react';
import { Pull } from './pull';

interface PullContextProps {
   pulls: Pull[];
}

export const PullsContext = createContext<PullContextProps>({pulls:[]});

export function usePulls(): Pull[] {
   return useContext(PullsContext).pulls;
}
