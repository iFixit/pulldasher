define(['underscore'], function(_) {
   /**
    * @param spec - The spec for this column's indicators
    * @param prefilter - An (optional) parent IndicatorFilter which will be run
    * on elements before this one is.
    */
   var constructor = function constructor(spec, prefilter) {
      /**
       * Creates indicators on the given element based on the given pull
       *
       * @param pull - The pull this is related to
       * @param element - The DOM element representing pull
       * @param template - A function which will return a new DOM node (attached to the element it is provided) every time it is called.
       */
      this.filter = function(pull, element, template) {
         var existing;

         // First, run any "predecessor" filters over it
         if (prefilter) {
            existing = prefilter.filter(pull, element, template);
         } else {
            existing = {};
         }

         // Then run the filter (if there is one)
         _.each(spec.indicators, function(indicator, key) {
            var indicatorNode;

            if (existing[key]) {
               indicatorNode = existing[key];
            } else {
               indicatorNode = template(element, key);
               existing[key] = indicatorNode;
            }

            if (indicator instanceof Function) {
               indicator(pull, indicatorNode);
            }
         });

         return existing;
      };
   };

   return constructor;
});
