import * as React from 'react';
import usePullsState from './pulls-state';
import { Pull } from './types';

export default function() {
   const pulls: Pull[] = usePullsState();
   return (
      <h1>Pulldasher! {pulls.length} pulls</h1>
   );
}
