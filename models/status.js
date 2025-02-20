import utils from "../lib/utils.js";

/**
 * An object representing the build status of the head commit of a pull.
 */
class Status {
  constructor(data) {
    this.data = {
      repo: data.repo,
      sha: data.sha,
      target_url: data.target_url,
      description: data.description,
      state: data.state,
      context: data.context,
      started_at: utils.toUnixTime(data.started_at),
      completed_at: utils.toUnixTime(data.completed_at),
    };
  }

  /**
   * Takes an object representing a DB row, and returns an object which mimics
   * a GitHub API response which may be used to initialize an instance of this
   * Status object.
   */
  static getFromDB(data) {
    return new Status({
      sha: data.commit,
      target_url: data.log_url,
      description: data.description,
      state: data.state,
      context: data.context,
      started_at: data.started_at,
      completed_at: data.completed_at,
    });
  }
}

export default Status;
