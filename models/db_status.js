import _ from "underscore";
import db from "../lib/db.js";

// Builds an object representation of a row in the DB `commit_statuses`
// table from an instance of the Status model
class DBStatus {
  constructor(status) {
    const statusData = status.data;
    this.data = {
      repo: statusData.repo,
      commit: statusData.sha,
      state: statusData.state,
      description: statusData.description,
      log_url: statusData.target_url,
      context: statusData.context,
      started_at: statusData.started_at,
      completed_at: statusData.completed_at,
    };
  }

  save() {
    const statusData = this.data;
    const q_update = "REPLACE INTO commit_statuses SET ?";
    return db.query(q_update, statusData);
  }

  toObject() {
    return _.extend({}, this.data);
  }
}

export default DBStatus;
