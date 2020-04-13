var config = require('./config-loader'),
    Bluebird = require('bluebird'),
    Promise = global.Promise,
    _      = require('underscore');

// Set the global Promise object up with the done method so that any
// promise by other libraries will have a .done()
Promise.prototype.done = Bluebird.prototype.done;
Promise = Bluebird;

module.exports = {
   /**
    * Converts `t` to a Unix timestamp from a Date object unless it's already
    * a number.
    */
   toUnixTime: function(date) {
      return (date && (typeof date) === 'object') ? date.getTime() / 1000 : date;
   },

   /**
    * Converts `t` to a Date object from a Unix timestamp unless it's not a
    * number.
    */
   fromUnixTime: function(t) {
      return (typeof t) === 'number' ? new Date(t * 1000) : t;
   },

   /**
    * Converts `str` to a Date object from a Date string (or null).
    * Returns null if str is falsy.
    */
   fromDateString: function(str) {
      return str ? ((str instanceof Date) ? str : new Date(str)) : null;
   },

   /**
    * Provide a function that returns an array of values for a given repo.
    * The second argument should be all arguments after the repository, since the
    * repository argument will be dealt with by this function.
    *
    * The function should take a repository name, and return an array of values.
    */
   forEachRepo: function(singleRepoLambda, args) {
      // default value
      args = args || [];
      args.unshift(null);
      var allRepoMap = function(currentRepo) {
         args[0] = currentRepo.name;
         return singleRepoLambda.apply(this, args);
      };
      return Promise.all(config.repos.map(allRepoMap))
      .then(function(repoItems) {
         return _.flatten(repoItems, /* shallow */ true);
      });
   }
};
