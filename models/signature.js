var config = require('../config');

/**
 * A block or signoff in a comment.
 */
function Signature(data)
{
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
 * Return an array of signatures constructed by parsing github comments for our
 *  custom tags.
 */
Signature.createFromGithubComments
   = function createFromGithubComments(comments, pullNumber) {

   return comments.reduce(function(comments, comment) {
      config.tags.forEach(function(tag) {
         if (hasTag(comment.body, tag)) {
            comments.push(
             new Signature({
                number: pullNumber,
                user: comment.user.login,
                // avatarUrl = "https://avatars.githubusercontent.com/u/" + user_id
                user_id: comment.user.id,
                type: tag,
                created_at: comment.created_at,
                // This field is unknown until all the signatures have been created and parsed.
                // See Pull.prototype.updateActiveSignatures()
                active: null,
                comment_id: comment.id
             }));
         }
      });

      return comments;
   }, []);
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
