var utils = require("../lib/utils"),
  db = require("../lib/db"),
  getLogin = require("../lib/get-user-login"),
  debug = require("../lib/debug")("pulldasher:db_comment");

/**
 * Builds an object representation of a row in the DB `comments` table
 * from the Comment object.
 */
function DBComment(comment) {
  var commentData = comment.data;
  this.data = {
    number: commentData.number,
    repo: commentData.repo,
    user: getLogin(commentData.user),
    date: utils.toUnixTime(commentData.created_at),
    comment_type: commentData.comment_type,
    comment_id: commentData.comment_id,
  };
}

DBComment.prototype.save = function () {
  var commentData = this.data;
  var q_update = "REPLACE INTO comments SET ?";

  return db.query(q_update, commentData);
};

DBComment.delete = function deleteComment(repo, type, comment_id) {
  debug("deleting %s comment %s in repo %s", type, comment_id, repo);
  var q_delete =
    "DELETE FROM comments \
                   WHERE `comment_type` = ? \
                   AND `comment_id` = ? \
                   AND `repo` = ?";

  return db.query(q_delete, [type, comment_id, repo]).then(function () {
    debug("deleted %s comment %s in repo %s", type, comment_id, repo);
  });
};

module.exports = DBComment;
