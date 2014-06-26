/**
 * PullFilter runs pulls through the various functions (optionally) provided by
 * the user to choose which pulls to display and how to order and group them.
 * It expects to be passed an array of pulls to filter, and it returns an array
 * of pulls that are properly filtered, sorted, and grouped (although the
 * groups are currently flattened.)
 *
 * The PullFilter is designed to support running chained with other event-based
 * objects and other PullFilters. Because Pulls are created by events from the
 * WebSockets, it was simple to have a PullFilter subscribe for the
 * resulting list of pulls, and then it could filter it as desired. Further,
 * there can be multiple subscribers to a given event, which enables more than
 * one resulting list of pulls, due to the PullFilter not modifying the list it
 * is passed, but only copying it.
 */
define(['underscore'], function(_) {
   var pullFilter = function (spec) {
      var listeners = [];

      var tryApply = function(obj, func, maybeFunction) {
         if (maybeFunction instanceof Function) {
            return func(obj, maybeFunction);
         }
         return obj;
      };

      var filter = function(pulls) {
         pulls = tryApply(pulls, _.filter, spec.selector);
         pulls = tryApply(pulls, _.sortBy, spec.sort);

         if (spec.group instanceof Function) {
            pulls = _.groupBy(pulls, spec.group);
            pulls = _.flatten(pulls);
         }

         return pulls;
      };

      _.extend(this, {
         filter: filter,

         update: function(pullList) {
            var filtered = filter(pullList);

            _.each(listeners, function(listener) {
               listener(filtered);
            });
         },

         onUpdate: function(listener) {
            listeners.push(listener);
         }
      });
   };

   return pullFilter;
});
