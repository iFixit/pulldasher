import utils from "../lib/utils.js";

/**
 * Build a Label object.
 */
class Label {
  constructor(data, pullNumber, repoFullName, user, created_at) {
    this.data = {
      title: data.name,
      number: pullNumber,
      repo: repoFullName,
      user: user,
      created_at: utils.fromDateString(created_at),
    };
  }

  /**
   * Takes an object representing a DB row, and returns an instance of this
   * Label object.
   */
  static getFromDB(data) {
    return new Label(
      { name: data.title },
      data.number,
      data.repo,
      data.user,
      utils.fromUnixTime(data.date)
    );
  }
}

export default Label;
