import utils from "../lib/utils.js";
import db from "../lib/db.js";

// Builds an object representation of a row in the DB `pull_labels` table
// from an instance of the Label model
class DBLabel {
  constructor(label) {
    const labelData = label.data;
    this.data = {
      number: labelData.number,
      title: labelData.title,
      repo: labelData.repo,
      user: labelData.user,
      date: utils.toUnixTime(labelData.created_at),
    };
  }

  save() {
    const labelData = this.data;
    const q_update = "REPLACE INTO pull_labels SET ?";
    return db.query(q_update, labelData);
  }

  delete() {
    const labelData = this.data;
    const q_update =
      "DELETE FROM pull_labels WHERE " + "number = ? AND title = ? AND repo = ?";

    return db.query(q_update, [
      labelData.number,
      labelData.title,
      labelData.repo,
    ]);
  }
}

export default DBLabel;
