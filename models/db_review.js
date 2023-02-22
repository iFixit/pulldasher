var utils = require("../lib/utils"),
  db = require("../lib/db"),
  getLogin = require("../lib/get-user-login"),
  debug = require("../lib/debug")("pulldasher:db_review");

/**
 * Builds an object representation of a row in the DB `reviews` table
 * from the Review object.
 */
function DBReview(review) {
  var reviewData = review.data;
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

DBReview.prototype.save = function () {
  var reviewData = this.data;
  var q_update = "REPLACE INTO reviews SET ?";

  return db.query(q_update, reviewData);
};

DBReview.delete = function deleteReview(repo, review_id) {
  debug("deleting %s review %s in repo %s", review_id, repo);
  var q_delete =
    "DELETE FROM reviews \
                   WHERE `review_id` = ? \
                     AND `repo` = ?";

  return db.query(q_delete, [review_id, repo]).then(function () {
    debug("deleted %s review %s in repo %s", review_id, repo);
  });
};

module.exports = DBReview;
