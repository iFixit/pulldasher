module.exports = Signature;

var config = require('../config');

/**
 * A block or signoff in a comment.
 */
function Signature(data)
{
   this.data = {
      number: data.number,
      user: data.user,
      user_id: data.user_id,
      type: data.type,
      created_at: data.created_at,
      active: data.active,
      comment_id: data.comment_id
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

var tagRegExps = {};

function hasTag(body, tagName) {
   if (typeof tagRegExps[tagName] === 'undefined') {
      // eg (^|\s)dev_block :.+?:(\s|$)
      tagRegExps[tagName]
         = new RegExp("(^|\\s)" + tagName + " :.+?:(\\s|$)");
   }
   return tagRegExps[tagName].test(body);
}
