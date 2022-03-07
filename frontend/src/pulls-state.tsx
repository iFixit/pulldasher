import { useState, useEffect } from 'react';
import { Socket } from './socket';
import { throttle } from 'underscore';
import { PullData, RepoSpec } from  './types';
import { Pull } from  './pull';

let repoSpecs: RepoSpec[] = [];
const pulls: Record<string, Pull> = {};
const dummyPulls: PullData[] = (process.env.DUMMY_PULLS || []) as PullData[];
dummyPulls.forEach(storePull);

function storePull(pullData: PullData) {
   pullData.repoSpec = repoSpecs.find(repo => repo.name == pullData.repo) || null;
   const pull: Pull = new Pull(pullData);
   pulls[pull.getKey()] = pull;
}

let socketInitialized = false;
function initSocket(onPullsChanged: (pulls: Pull[]) => void) {
   socketInitialized = true;
   const pullRefresh = () => onPullsChanged(Object.values(pulls));
   const throttledPullRefresh: () => void = throttle(pullRefresh, 500);
   Socket((socket: SocketIOClient.Socket) => {
      socket.on('initialize', function(data: {repos: RepoSpec[], pulls: Pull[]}) {
         repoSpecs = data.repos;
         data.pulls.forEach(storePull);
         throttledPullRefresh();
      });

      socket.on('pullChange', function(pull: PullData) {
         storePull(pull);
         throttledPullRefresh();
      });
   });
}

export function usePullsState(): Pull[] {
   const pullArray = Object.values(pulls);
   const [pullState, setPullsState] = useState(pullArray);
   // If we have stubbed the pull list, we are in front-end-only mode and
   // don't need a socket to a backend that doesn't exist
   if (!dummyPulls.length && !socketInitialized) {
      initSocket(setPullsState);
   }
   return pullState;
}
