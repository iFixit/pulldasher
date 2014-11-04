var utils = require('../lib/utils'),
    db = require('../lib/db'),
    Promise = require('promise');


// Builds an object representation of a row in the DB `pull_labels` table
// from the data returned by GitHub's API.
function DBLabel(label) {
   this.data = {
      number: label.number,
      title: label.title,
      repo_name: label.repo_name,
      user: label.user,
      date: utils.toUnixTime(label.created_at)
   };
}

DBLabel.prototype.save = function() {
   var labelData = this.data;
   var q_update = 'REPLACE INTO pull_labels SET ?';

   return db.query(q_update, labelData);
};

DBLabel.prototype.delete = function() {
   var labelData = this.data;
   var q_update = 'DELETE FROM pull_labels WHERE ' +
    'number = ? AND title = ? AND repo_name = ?';

   return db.query(q_update, [labelData.number, labelData.title,
    labelData.repo_name]);
};

module.exports = DBLabel;
