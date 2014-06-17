/**
 * Provides the ability to transform elements using data in the spec.
 */
define(['underscore'], function(_) {
   /**
    * Constructor
    *
    * @param theSpec A JavaScript object describing this ElementManager's job
    * @param theParent An (optional) parent ElementManager which will be used as a source for elements as needed.
    */
   var constructor = function(spec, prefilter) {
      return {
         filter: function(pull, element) {
            if (prefilter) {
               var updated = prefilter.filter(pull, element);
               if (updated) {
                  element = updated;
               }
            }

            if (spec.adjust instanceof Function) {
               spec.adjust(pull, element);
            }
         }
      };
   };
   return constructor;
});
