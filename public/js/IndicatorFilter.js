// IndicatorFilter handles rendering the indicators onto each pull
define(['jquery', 'underscore'], function($, _) {
   /**
    * @param indicators - The spec for this column's indicators. It is an
    * object with a function for each indicator.
    * @param prefilter - An (optional) argument. If an IndicatorFilter is
    * passed, it will be called before this one.
    */
   var constructor = function constructor(indicators, prefilter) {
      /**
       * Creates indicators on the given element based on the given pull
       *
       * @param pull - The pull this is related to
       * @param element - The DOM element representing pull
       * @param template - A function which will return a new DOM node
       *  every time it is called. It
       * is passed two arguments: the value of the element argument and the key
       * of the current indicator.
       */
      this.filter = function(pull, element, template) {
         // Stores indicator nodes which were created by a prefilter run.
         var existingIndicatorNodes;

         // First, run any "predecessor" filters over it
         if (prefilter instanceof constructor) {
            // Get the existing nodes this prefilter made
            existingIndicatorNodes = prefilter.filter(pull, element, template);
         } else {
            // There are no nodes (because there's no prefilter to make them.)
            // Create a new object to store the ones we're going to make.
            existingIndicatorNodes = {};
         }

         // Then run the filter (if there is one)
         _.each(indicators, function(indicator, key) {
            var indicatorNode;

            // If the (potential) prefilter run has created a node for this
            // indicator already, look it up
            if (existingIndicatorNodes[key]) {
               // Reuse the existing node for this indicator.
               indicatorNode = existingIndicatorNodes[key];
            } else {
               // If there's a node with a class equal to the indicator key in
               // the pull template, use it.
               var matchingNodes = $('.' + key, element);
               if (matchingNodes.length > 0) {
                  // Use the first matching node
                  indicatorNode = matchingNodes.first();
               } else {
                  // There is no existing node for this indicator. Create a new
                  // one.
                  indicatorNode = template(element, key);
               }
               existingIndicatorNodes[key] = indicatorNode;
            }

            if (indicator instanceof Function) {
               indicator(pull, indicatorNode);
            }
         });

         return existingIndicatorNodes;
      };
   };

   return constructor;
});
