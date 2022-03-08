import { useState, useEffect } from 'react';
import { createPullSocket } from '../backend/pull-socket';
import { throttle } from 'underscore';
import { PullData, RepoSpec } from  '../types';
import { Pull } from  '../pull';

function onPullsChanged(pullsChanged: (pulls: Pull[]) => void) {
   const pulls: Record<string, Pull> = {};
   const pullRefresh = () => pullsChanged(Object.values(pulls));
   const throttledPullRefresh: () => void = throttle(pullRefresh, 500);

   createPullSocket((pullDatas: PullData[], repoSpecs: RepoSpec[]) => {
      pullDatas.forEach((pullData: PullData) => {
         pullData.repoSpec = repoSpecs.find(repo => repo.name == pullData.repo) || null;
         const pull: Pull = new Pull(pullData);
         pulls[pull.getKey()] = pull;
      });
      throttledPullRefresh();
   });
}

/**
 * Note: This is only meant to be used in one component
 */
let socketInitialized = false;
export function usePullsState(): Pull[] {
   const [pullState, setPullsState] = useState<Pull[]>([]);
   useEffect(() => {
      if (socketInitialized) {
         throw new Error("usePullsState() connects to socket-io and is only meant to be used in the PullsProvider component, see usePulls() instead.");
      }
      // If we have stubbed the pull list, we are in front-end-only mode and
      // don't need a socket to a backend that doesn't exist
      if (!socketInitialized) {
         socketInitialized = true;
         onPullsChanged(setPullsState);
      }
   }, []);
   return pullState;
}
