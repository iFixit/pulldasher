import utils from '../lib/utils.js';
import db from '../lib/db.js';
import getLogin from '../lib/get-user-login.js';

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
      const q_update = 'REPLACE INTO reviews SET ?';
      return db.query(q_update, reviewData);
   }
}

export default DBReview;
