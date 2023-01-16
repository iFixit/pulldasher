import { Pull } from "../pull";
import { PullData, Signature, SignatureType, CommentSource , StatusState } from "../types";

const COMMENT_ID = 13371337;

export const dummyPulls: PullData[] = fakeCIStatuses((process.env.DUMMY_PULLS || []) as PullData[]);
export function hasDummyPulls() {
   return dummyPulls.length > 0;
}

function addSynthReview(pull: Pull) {
  const signed: PullData = {
    ...pull,
    status: {
      ...pull.status,
      allQA: [...pull.status.allQA, getFakeSig(pull.number, SignatureType.QA)],
      allCR: [...pull.status.allCR, getFakeSig(pull.number, SignatureType.CR)],
    },
  };
  return new Pull(signed);
}

function removeSynthReview(pull: Pull) {
  const unsigned: PullData = {
    ...pull,
    status: {
      ...pull.status,
      allQA: pull.status.allQA.filter((sig) => !isSynthComment(sig)),
      allCR: pull.status.allCR.filter((sig) => !isSynthComment(sig)),
    },
  };
  return new Pull(unsigned);
}

export function toggleSynthReview(pull: Pull) {
  const isFaked = pull.status.allQA.find(isSynthComment);
  if (isFaked) {
    return removeSynthReview(pull);
  } else {
    return addSynthReview(pull);
  }
}

function getFakeSig(number: number, type: SignatureType) {
  return {
    data: {
      repo: "iFixit/ifixit",
      number,
      user: {
        id: 13455801,
        login: "danielbeardsley",
      },
      type,
      created_at: "1970-11-16T20:06:15.000Z",
      active: 1,
      comment_id: COMMENT_ID,
      source_type: CommentSource.review,
    },
  };
}

function isSynthComment(sig: Signature) {
  return sig.data.comment_id === COMMENT_ID;
}

function unix() {
   return Date.now() / 1000;
}

function finishedState() {
   const r = Math.random();
   return r < 0.01 ? StatusState.error :
      (r < 0.03 ? StatusState.failure : StatusState.success);
}

function fakeCIStatuses(pulls: PullData[]) {
   const fakeContexts = ['psalm', 'deploy', 'unit-tests', 'api', 'integration', 'browser', 'bundle-analysis'];
   pulls.forEach((pull) => {
      pull.status.commit_statuses = fakeContexts.map((context) => {
         const now = unix();
         const startedAt = now - (Math.random() * 120 * 60);
         const duration = Math.random() * 10 * 60;
         const completedAt = startedAt + duration;
         return {data: {
            sha: "fake sha",
            target_url: "https://example.com",
            description: context,
            context: context,
            state: completedAt > now ? StatusState.pending : finishedState(),
            started_at: startedAt,
            completed_at: completedAt > now ? null : completedAt,
         }};
      });
   });
   return pulls;
}
