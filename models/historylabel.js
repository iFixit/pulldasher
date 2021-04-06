var utils  = require('../lib/utils');

/**
 * Build a History Label object.
 */
function HistoryLabel(data, pullNumber, repoFullName, user, created_at, removed_at) {
   this.data = {
      title: data.name,
      number: pullNumber,
      repo: repoFullName,
      user: user,
      created_at: utils.fromDateString(created_at),
      removed_at: utils.fromDateString(removed_at)
   };
}


/**
 * Takes an object representing a DB row, and returns an instance of this
 * Label object.
 */
HistoryLabel.getFromDB = function getFromDB(data) {
   return new HistoryLabel(
      { name: data.title },
      data.number,
      data.repo,
      data.user,
      utils.fromUnixTime(data.date_added),
      utils.fromUnixTime(data.date_removed)
   );
};

module.exports = HistoryLabel;
