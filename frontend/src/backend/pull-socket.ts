import { Pull } from '../pull';
import { getSocket } from './socket';
import { PullData, RepoSpec } from  '../types';

type PullUpdater = (pullDatas: PullData[], repoSpecs: RepoSpec[]) => void;
let repoSpecs: RepoSpec[] = [];
export const dummyPulls: PullData[] = (process.env.DUMMY_PULLS || []) as PullData[];

/**
 * connects to the backend and calls the callback each time we receive
 * pullChange events from the server.
 */
function pullSocket(pullsUpdated: PullUpdater) {
   const socket = getSocket();
   socket.on('initialize', function(data: {repos: RepoSpec[], pulls: PullData[]}) {
      repoSpecs = data.repos;
      pullsUpdated(data.pulls, repoSpecs)
   });

   socket.on('pullChange', function(pull: PullData) {
      pullsUpdated([pull], repoSpecs)
   });
}

function sendRefreshPull(pull: Pull) {
   const socket = getSocket();
   socket.emit('refresh', pull.repo, pull.number);
}

/**************
 * When we are faking the backend with a dummy array of pulls,
 * we need to fake other backend interactions (like refresh)
 */

let pullsUpdatedHandler: PullUpdater|null;
function mockPullSocket(pullsUpdated: PullUpdater) {
   pullsUpdatedHandler = pullsUpdated;
   return pullsUpdated(dummyPulls, repoSpecs);
}

export function mockRefreshPull(pull: Pull) {
   // Pretend the pull is updated from the server-side a bit later.
   setTimeout(() => {
      if (pullsUpdatedHandler) {
         pullsUpdatedHandler([pull], []);
      }
   }, 2000);
}

export const createPullSocket = dummyPulls.length ? mockPullSocket: pullSocket;
export const refreshPull = dummyPulls.length ? mockRefreshPull : sendRefreshPull;
