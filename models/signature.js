var config = require('../config'),
    getLogin = require('../lib/get-user-login'),
    getUserid = require('../lib/get-user-id'),
    utils = require('../lib/utils');

/**
 * A block or signoff in a comment.
 */
function Signature(data) {
   this.data = {
      repo:             data.repo,
      number:           data.number,
      user: {
         id:            getUserid(data.user),
         login:         getLogin(data.user)
      },
      type:             data.type,
      created_at:       utils.fromDateString(data.created_at),
      active:           data.active,
      comment_id:       data.comment_id
   };
}

/**
 * Parses a GitHub comment and returns an array of Signature objects.
 * Returns an empty array if the comment did not contain any of our tags.
 */
Signature.parseComment = function parseComment(comment, repoFullName, pullNumber) {
   var signatures = [];
   config.tags.forEach(function(tag) {
      if (hasTag(comment.body, tag)) {
         signatures.push(new Signature({
            repo: repoFullName,
            number: pullNumber,
            user: {
               id:    getUserid(comment.user),
               login: getLogin(comment.user)
            },
            type: tag.name,
            created_at: comment.created_at,
            // `active` is unknown until all the signatures have been created
            // and parsed. See Pull.prototype.updateActiveSignatures()
            active: true,
            comment_id: comment.id
         }));
      }
   });

   return signatures;
};

/**
 * Takes an object representing a DB row, and returns an instance of this
 * Signature object.
 */
Signature.getFromDB = function(data) {
   var sig = new Signature({
      repo:        data.repo,
      number:      data.number,
      user: {
         id:       data.userid,
         login:    data.user
      },
      type:        data.type,
      created_at:  utils.fromUnixTime(data.date),
      active:      data.active,
      comment_id:  data.comment_id
   });

   return sig;
};

/**
 * A compare function for Signatures that can be passed to a custom sorter.
 * Sorts signatures in chronologically
 */
Signature.compare = function(a, b) {
   return Date.parse(a.data.created_at) - Date.parse(b.data.created_at);
};

module.exports = Signature;

function hasTag(body, tag) {
   return tag.regex.test(body);
}
