import { getSocket } from './socket';
import { PullData, RepoSpec } from  '../types';

type PullUpdater = (pullDatas: PullData[], repoSpecs: RepoSpec[]) => void;
let repoSpecs: RepoSpec[] = [];
export const dummyPulls: PullData[] = (process.env.DUMMY_PULLS || []) as PullData[];

/**
 * connects to the backend and calls the callback each time we receive
 * pullChange events from the server.
 */
export function createPullSocket(pullsUpdated: PullUpdater) {
   if (dummyPulls.length) {
      return pullsUpdated(dummyPulls, repoSpecs);
   }

   const socket = getSocket();
   socket.on('initialize', function(data: {repos: RepoSpec[], pulls: PullData[]}) {
      repoSpecs = data.repos;
      pullsUpdated(data.pulls, repoSpecs)
   });

   socket.on('pullChange', function(pull: PullData) {
      pullsUpdated([pull], repoSpecs)
   });
}
