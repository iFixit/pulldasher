var utils  = require('../lib/utils');

/**
 * Build a Label object.
 */
function Label(data, pullNumber, repoName, repoFullName, user, created_at) {
   this.data = {
      title: data.name,
      number: pullNumber,
      repo: repoFullName,
      repo_name: repoName,
      user: user,
      created_at: utils.fromDateString(created_at)
   };
}


/**
 * Takes an object representing a DB row, and returns an instance of this
 * Label object.
 */
Label.getFromDB = function getFromDB(data) {
   return new Label(
      { name: data.title },
      data.number,
      data.repo_name,
      data.repo,
      data.user,
      utils.fromUnixTime(data.date)
   );
};

module.exports = Label;
