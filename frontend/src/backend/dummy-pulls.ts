import { Pull } from "../pull";
import { PullData, Signature, SignatureType, CommentSource } from "../types";

const COMMENT_ID = 13371337;

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
