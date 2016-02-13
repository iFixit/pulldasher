var utils = require('../lib/utils');

/**
 * A Pull Request comment.
 */
function Comment(data) {
   this.data = {
      number:        data.number,
      repo:          data.repo,
      user: {
         login: data.user.login
      },
      created_at:    new Date(data.created_at),
      comment_id:    data.id
   };
}

/**
 * Takes an object representing a DB row, and returns an instance of this
 * Comment object.
 */
Comment.getFromDB = function(data) {
   return new Comment({
      number:     data.number,
      repo:       data.repo_name,
      user: {
         login: data.user
      },
      created_at: utils.fromUnixTime(data.date),
      id: data.comment_id
   });
};

module.exports = Comment;
