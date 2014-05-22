module.exports = Signature;

/**
 * A block or signoff on in a comment.
 */
function Signature(dbData)
{
   this.data = dbData;
}

/**
 * Return an array of signatures constructed by parsing github comments for our
 *  custom tags.
 */
Signature.createFromGithubComments
   = function createFromGithubComments(comments, pullNumber)
{
   return comments.reduce(function(comments, comment)
   {
      tags.forEach(function(tag)
      {
         if (hasTag(comment.body, tag))
         {
            comments.push(
               new Signature({
                  number: pullNumber,
                  user: comment.user.login,
                  user_id: comment.user.id, // avatarUrl = "https://avatars.githubusercontent.com/u/" + user_id
                  type: tag,
                  created_at: comment.created_at,
                  active: null,
                  comment_id: comment.id
               })
            );
         }
      });
      return comments;
   }, []);
}

var tags = ['QA', 'CR', 'dev_block', 'deploy_block', 'un_dev_block', 'un_deploy_block'];
Signature.tags = tags;
var tagRegExps = {};
function hasTag(body, tagName)
{
   if (typeof tagRegExps[tagName] === 'undefined')
   {
      // eg (^|\s)dev_block :.+?:(\s|$)
      tagRegExps[tagName]
         = new RegExp("(^|\\s)" + tagName + " :.+?:(\\s|$)");
   }
   return tagRegExps[tagName].test(body);
}
