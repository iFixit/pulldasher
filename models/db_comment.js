import utils from "../lib/utils.js";
import db from "../lib/db.js";
import getLogin from "../lib/get-user-login.js";
import debug from "../lib/debug.js";

const log = debug("pulldasher:db_comment");

/**
 * Builds an object representation of a row in the DB `comments` table
 * from the Comment object.
 */
class DBComment {
  constructor(comment) {
    const commentData = comment.data;
    this.data = {
      number: commentData.number,
      repo: commentData.repo,
      user: getLogin(commentData.user),
      date: utils.toUnixTime(commentData.created_at),
      comment_type: commentData.comment_type,
      comment_id: commentData.comment_id,
    };
  }

  save() {
    const commentData = this.data;
    const q_update = "REPLACE INTO comments SET ?";
    return db.query(q_update, commentData);
  }

  static delete(repo, type, comment_id) {
    log("deleting %s comment %s in repo %s", type, comment_id, repo);
    const q_delete =
      "DELETE FROM comments \
                   WHERE `comment_type` = ? \
                   AND `comment_id` = ? \
                   AND `repo` = ?";

    return db.query(q_delete, [type, comment_id, repo]).then(() => {
      log("deleted %s comment %s in repo %s", type, comment_id, repo);
    });
  }
}

export default DBComment;
