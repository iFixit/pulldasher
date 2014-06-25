/**
 * Provides the ability to transform elements using data in the spec.
 */
define(['underscore'], function(_) {
   /**
    * Constructor
    *
    * @param theSpec A JavaScript object describing this ElementFilter's job
    * @param theParent An (optional) parent ElementFilter which will be used as a source for elements as needed.
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
