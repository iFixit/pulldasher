var config = require('../config');
/**
 * Build a Label object.
 */
function Label(data, pullNumber, repoName, user) {
   this.data = {
      title: data.name,
      number: pullNumber,
      repo_name: repoName,
      user: user
   };
}


/**
 * Takes an object representing a DB row, and returns an object which mimics
 * a GitHub API response which may be used to initialize an instance of this
 * Label object.
 */
Label.getFromDB = function getFromDB(data) {
   return {
      name: data.title,
   };
};

module.exports = Label;
