var config = require("../lib/config-loader"),
  getLogin = require("../lib/get-user-login"),
  getUserid = require("../lib/get-user-id"),
  utils = require("../lib/utils");

/**
 * A block or signoff in a comment.
 */
function Signature(data) {
  this.data = {
    repo: data.repo,
    number: data.number,
    user: {
      id: getUserid(data.user),
      login: getLogin(data.user),
    },
    type: data.type,
    created_at: utils.fromDateString(data.created_at),
    active: data.active,
    comment_id: data.comment_id,
  };
}

/**
 * Parses a GitHub comment and returns an array of Signature objects.
 * Returns an empty array if the comment did not contain any of our tags.
 */
Signature.parseComment = function parseComment(
  comment,
  repoFullName,
  pullNumber
) {
  const commentData = {
    repo: repoFullName,
    number: pullNumber,
    body: comment.body,
    user: comment.user,
    created_at: comment.created_at,
    id: comment.id,
  };

  return parseSignatures(commentData);
};

/**
 * Parses a GitHub review and returns an array of Signature objects.
 * Returns an empty array if the comment did not contain any of our tags.
 */
Signature.parseReview = function parseReview(review, repoFullName, pullNumber) {
  const reviewData = {
    repo: repoFullName,
    number: pullNumber,
    body: review.body,
    user: review.user,
    created_at: review.submitted_at,
    id: review.id,
  };

  return parseSignatures(reviewData);
};

function parseSignatures(data) {
  let signatures = [];

  config.tags.forEach(function (tag) {
    if (hasTag(data.body, tag)) {
      signatures.push(
        new Signature({
          repo: data.repo,
          number: data.number,
          user: {
            id: getUserid(data.user),
            login: getLogin(data.user),
          },
          type: tag.name,
          created_at: data.created_at,
          active: true,
          comment_id: data.id,
        })
      );
    }
  });

  return signatures;
}

/**
 * Takes an object representing a DB row, and returns an instance of this
 * Signature object.
 */
Signature.getFromDB = function (data) {
  var sig = new Signature({
    repo: data.repo,
    number: data.number,
    user: {
      id: data.userid,
      login: data.user,
    },
    type: data.type,
    created_at: utils.fromUnixTime(data.date),
    active: data.active,
    comment_id: data.comment_id,
  });

  return sig;
};

/**
 * A compare function for Signatures that can be passed to a custom sorter.
 * Sorts signatures in chronologically
 */
Signature.compare = function (a, b) {
  return Date.parse(a.data.created_at) - Date.parse(b.data.created_at);
};

module.exports = Signature;

function hasTag(body, tag) {
  return tag.regex.test(body);
}
