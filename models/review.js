import utils from "../lib/utils.js";
import getLogin from "../lib/get-user-login.js";

/**
 * A Pull Request review.
 */
class Review {
  constructor(data) {
    this.data = {
      repo: data.repo,
      review_id: data.id,
      number: data.number,
      body: data.body,
      state: data.state,
      user: {
        login: getLogin(data.user),
      },
      submitted_at: new Date(data.submitted_at),
    };
  }

  /**
   * Takes an object representing a DB row, and returns an instance of this
   * Review object.
   */
  static getFromDB(data) {
    return new Review({
      repo: data.repo,
      id: data.review_id,
      number: data.number,
      body: data.body,
      state: data.state,
      user: {
        login: data.user,
      },
      submitted_at: utils.fromUnixTime(data.date),
    });
  }
}

export default Review;
