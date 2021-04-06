var utils = require('../lib/utils'),
    db = require('../lib/db');

// Builds an object representation of a row in the DB `pull_labels` table
// from an instance of the Label model
function DBHistoryLabel(historylabel) {
   var historylabelData = historylabel.data;
   this.data = {
      number: historylabelData.number,
      title: historylabelData.title,
      repo: historylabelData.repo,
      user: historylabelData.user,
      date_added: utils.toUnixTime(historylabelData.created_at),
      date_removed: utils.toUnixTime(historylabelData.removed_at)
   };
}

DBHistoryLabel.prototype.save = function() {
   var historylabelData = this.data;
   historylabelData.date_removed = 0;
   var q_update = 'REPLACE INTO pull_labels_history SET ?'; // Using insert instead of replace

   return db.query(q_update, historylabelData);
};

DBHistoryLabel.prototype.update = function() {
   var historylabelData = this.data;
   var q_update = 'UPDATE pull_labels_history SET date_removed = ? WHERE ' +
    'number = ? AND title = ? AND repo = ?';

   return db.query(q_update, [historylabelData.date_removed, historylabelData.number, historylabelData.title,
    historylabelData.repo]);
};

module.exports = DBHistoryLabel;
