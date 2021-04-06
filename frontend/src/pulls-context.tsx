import * as React from 'react';
import { useContext } from 'react';
import { Pull } from './types';

interface PullContextProps {
   pulls: Pull[];
}

const PullsContext = React.createContext<PullContextProps>({pulls:[]});

export default PullsContext;

export function usePulls(): Pull[] {
   return useContext(PullsContext).pulls;
}
