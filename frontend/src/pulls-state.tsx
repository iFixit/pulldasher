import { useState, useEffect } from 'react';
import Socket from './socket';
import { throttle } from 'underscore';
import { Pull, RepoSpec } from  './types';

var repoSpecs: RepoSpec[] = [];
var pulls: Record<string, Pull> = {};
var dummyPulls: Pull[] = (process.env.DUMMY_PULLS || []) as Pull[];
dummyPulls.forEach(storePull);

function storePull(pull: Pull) {
   addRepoSpec(pull);
   const pullKey = pull.repo + "#" + pull.number;
   pulls[pullKey] = pull;
}

function addRepoSpec(pull: Pull) {
   pull.repoSpec = repoSpecs.find(repo => repo.name == pull.repo) || null;
}

function initSocket(onPullsChanged: (pulls: Pull[]) => void) {
   const update = () => onPullsChanged(Object.values(pulls));
   const throttledUpdate = throttle(update, 500);

   Socket((socket) => {
      socket.on('initialize', function(data: {repos: any[], pulls: Pull[]}) {
         repoSpecs = data.repos;
         data.pulls.forEach(storePull);
         update();
      });

      socket.on('pullChange', function(pull) {
         storePull(pull);
         throttledUpdate();
      });
   });
}

export default function(): Pull[] {
   const [pullState, setPullsState] = useState(Object.values(pulls));
   useEffect(() => {
      // If we have stubbed the pull list, we are in front-end-only mode and
      // don't need a socket to a backend that doesn't exist
      if (!dummyPulls.length) {
         initSocket(setPullsState);
      }
   }, []);
   return pullState;
};
