/** ElementFilter runs pulls and their associated DOM nodes through a function
 * which can do whatever it wants to them. It is intended to make it easy to
 * modify or tweak the display of the pulls. ElementFilters can be chained, by
 * passing an ElementFilter which should be run before this one to the
 * constructor when creating this one, it will automatically be run over
 * elements which are filtered through this one.
 *
 * The choice to chain ElementFilters from the bottom (i.e., elements are
 * passed to the bottom filter, and it runs the previous filter on them, which
 * could run the previous filter on them, and so on) was made because it allows
 * the elements to be created by something other than the ElementFilter. If the
 * choice had been made to have pulls passed directly to the top ElementFilter
 * in the chain, it would have been necessary to support creating DOM elements
 * from pulls in the ElementFilter. This way, a function can call the
 * composition of multiple ElementFilters just as simply as it can call one.
 */
define(['underscore'], function(_) {
   /**
    * Constructor
    *
    * @param theSpec A JavaScript object describing this ElementFilter's job
    * @param theParent An (optional) parent ElementFilter which will be run on
    * elements before this one is.
    */
   var constructor = function(spec, prefilter) {
      return {
         filter: function(pull, element) {
            // Later possibilities: a message object that can carry data from
            // the prefilter to the current filter, and an array of filters, to
            // make it cleaner to put multiple things on a pull. The message
            // object could also be automatically set to tell if there was an
            // adjust that was run.

            // First, run any "predecessor" filters over it
            if (prefilter) {
               prefilter.filter(pull, element);
            }

            // Then run the filter (if there is one)
            if (spec.adjust instanceof Function) {
               spec.adjust(pull, element);
            }
         }
      };
   };
   return constructor;
});
