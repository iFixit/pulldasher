var config = require('../config');

/**
 * A block or signoff in a comment.
 */
function Signature(data) {
   this.data = {
      number:           data.number,
      user:             data.user,
      user_id:          data.user_id,
      type:             data.type,
      created_at:       data.created_at,
      active:           data.active,
      comment_id:       data.comment_id
   };
}

/**
 * Parses a GitHub comment and returns an array of Signature objects.
 * Returns an empty array if the comment did not contain any of our tags.
 */
Signature.parseComment = function parseComment(comment, pullNumber) {
   var signatures = [];
   config.tags.forEach(function(tag) {
      if (hasTag(comment.body, tag)) {
         signatures.push(new Signature({
            number: pullNumber,
            user: comment.user.login,
            // avatarUrl = "https://avatars.githubusercontent.com/u/" + user_id
            user_id: comment.user.id,
            type: tag,
            created_at: comment.created_at,
            // `active` is unknown until all the signatures have been created
            // and parsed. See Pull.prototype.updateActiveSignatures()
            active: true,
            comment_id: comment.id
         }));
      }
   });

   return signatures;
}

/**
 * Takes an object representing a DB row, and returns an object which mimics
 * a GitHub API response which may be used to initialize an instance of this
 * Signature object.
 */
Signature.getFromDB = function(data) {
   return {
      number:     data.number,
      user:       data.user,
      type:       data.type,
      created_at: data.created_at,
      active:     data.active,
      comment_id: data.comment_id
   };
}

/**
 * A compare function for Signatures that can be passed to a custom sorter.
 * Sorts signatures in chronologically
 */
Signature.compare = function(a, b) {
   return Date.parse(a.data.created_at) - Date.parse(b.data.created_at);
};

module.exports = Signature;

var tagRegExps = {};

function hasTag(body, tagName) {
   if (typeof tagRegExps[tagName] === 'undefined') {
      // e.g. "dev_block :+1:" or " CR :asdf:."
      tagRegExps[tagName]
         = new RegExp("\\b" + tagName + " :[^\n:]+:");
   }
   return tagRegExps[tagName].test(body);
}
