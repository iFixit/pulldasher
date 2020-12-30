import * as React from 'react';
import { Pull } from './types';

interface PullContextProps {
   pulls: Pull[];
}

const PullsContext = React.createContext<PullContextProps>({pulls:[]});

export default PullsContext;
