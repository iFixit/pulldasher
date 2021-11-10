import { createContext, useContext } from 'react';
import { Pull } from './pull';

interface PullContextProps {
   pulls: Pull[];
}

const PullsContext = createContext<PullContextProps>({pulls:[]});

export default PullsContext;

export function usePulls(): Pull[] {
   return useContext(PullsContext).pulls;
}
