var config = require('../config');

/**
 * A Pull Request comment.
 */
function Comment(data) {
   this.data = {
      number:        data.number,
      repo:          data.repo,
      user:          data.user.login,
      created_at:    data.created_at,
      comment_id:    data.id
   };
}

/**
 * Takes an object representing a DB row, and returns an object which mimics
 * a GitHub API response which may be used to initialize an instance of this
 * Comment object.
 */
Comment.getFromDB = function(data) {
   return {
      number:     data.number,
      repo:       data.repo_name,
      user: {
         login: data.user
      },
      created_at: data.created_at,
      id: data.comment_id
   };
}

module.exports = Comment;
