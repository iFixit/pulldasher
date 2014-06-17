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
