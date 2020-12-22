import * as React from 'react';
import usePullsState from './pulls-state';

export default function() {
   const pulls = usePullsState();
   return (
      <h1>Pulldasher! {pulls.length} pulls</h1>
   );
}
