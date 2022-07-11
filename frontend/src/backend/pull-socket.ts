import { Pull } from '../pull';
import { getSocket } from './socket';
import { PullData, RepoSpec, Signature, SignatureType, CommentSource } from  '../types';
import { dummyPulls } from  '../utils';

type PullUpdater = (pullDatas: PullData[], repoSpecs: RepoSpec[]) => void;
let repoSpecs: RepoSpec[] = [];

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
         const comment_id = 13371337
         const isSynthComment = (sig: Signature) => sig.data.comment_id === comment_id
         const sig = (type: SignatureType) => ({
            data: {
               repo: "iFixit/ifixit",
               number: pull.number,
               user: {
                  id: 13455801,
                  login: "danielbeardsley",
               },
               type,
               created_at: "1970-11-16T20:06:15.000Z",
               active: 1,
               comment_id,
               source_type: CommentSource.review,
            },
         });
         const signed: PullData = {
            ...pull,
            status: {
               ...pull.status,
               allQA: [...pull.status.allQA, sig(SignatureType.QA)],
               allCR: [...pull.status.allCR, sig(SignatureType.CR)],
            },
         };
         const unsigned: PullData = {
            ...pull,
            status: {
               ...pull.status,
               allQA: pull.status.allQA.filter((sig) => !isSynthComment(sig)),
               allCR: pull.status.allCR.filter((sig) => !isSynthComment(sig)),
            },
         };
         const isFaked = pull.status.allQA.find(isSynthComment)
         const updatedPull = new Pull(isFaked ? unsigned : signed);
         pullsUpdatedHandler([updatedPull], []);
      }
   }, 2000);
}

export const createPullSocket = dummyPulls.length ? mockPullSocket: pullSocket;
export const refreshPull = dummyPulls.length ? mockRefreshPull : sendRefreshPull;
