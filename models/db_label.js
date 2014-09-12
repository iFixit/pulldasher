var _ = require('underscore'),
    config = require('../config'),
    db = require('../lib/db'),
    Promise = require('promise');


// Builds an object representation of a row in the DB `pull_labels` table
// from the data returned by GitHub's API.
function DBLabel(label) {
   this.data = {
      number: label.data.number,
      title: label.data.title,
      repo_name: config.repo.name,
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
