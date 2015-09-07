var utils = require('../lib/utils'),
    db = require('../lib/db');

/**
 * Builds an object representation of a row in the DB `comments` table
 * from the Comment object.
 */
function DBComment(comment) {
   var commentData = comment.data;
   this.data = {
      number:     commentData.number,
      repo_name:  commentData.repo,
      user:       commentData.user.login,
      date:       utils.toUnixTime(commentData.created_at),
      comment_id: commentData.comment_id
   };
}

DBComment.prototype.save = function() {
   var commentData = this.data;
   var q_update = 'REPLACE INTO comments SET ?';

   return db.query(q_update, commentData);
};

module.exports = DBComment;
