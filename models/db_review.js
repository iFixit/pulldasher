import utils from "../lib/utils.js";
import db from "../lib/db.js";
import getLogin from "../lib/get-user-login.js";
import debug from "../lib/debug.js";

const log = debug("pulldasher:db_review");

/**
 * Builds an object representation of a row in the DB `reviews` table
 * from the Review object.
 */
class DBReview {
  constructor(review) {
    const reviewData = review.data;
    this.data = {
      repo: reviewData.repo,
      review_id: reviewData.review_id,
      number: reviewData.number,
      body: reviewData.body,
      state: reviewData.state,
      user: getLogin(reviewData.user),
      date: utils.toUnixTime(reviewData.submitted_at),
    };
  }

  save() {
    const reviewData = this.data;
    const q_update = "REPLACE INTO reviews SET ?";
    return db.query(q_update, reviewData);
  }

  static delete(repo, review_id) {
    log("deleting %s review %s in repo %s", review_id, repo);
    const q_delete =
      "DELETE FROM reviews \
                   WHERE `review_id` = ? \
                     AND `repo` = ?";

    return db.query(q_delete, [review_id, repo]).then(() => {
      log("deleted %s review %s in repo %s", review_id, repo);
    });
  }
}

export default DBReview;
