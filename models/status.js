/**
 * An object representing the build status of the head commit of a pull.
 */
function Status(data) {
   this.data = {
      sha: data.sha,
      target_url: data.target_url,
      description: data.description,
      state: data.state
   };
}

/**
 * Takes an object representing a DB row, and returns an object which mimics
 * a GitHub API response which may be used to initialize an instance of this
 * Status object.
 */
Status.getFromDB = function(data) {
   return {
      sha:           data.commit,
      target_url:    data.log_url,
      description:   data.description,
      state:         data.state
   };
};

module.exports = Status;
