define(['jquery', 'Templates', 'IndicatorFilter'], function($, Templates, IndicatorFilter) {
   /**
    * Renders the page indicators specified by spec.page_indicators
    * into the container specified by spec.page_indicator_box
    */
   var constructor = function(spec, indicatorContainer) {
      var indicatorFilter = new IndicatorFilter(spec, null);

      return {
         handle: function(pulls) {
            indicatorContainer.empty();
            indicatorFilter.filter(pulls, indicatorContainer, function(elem, filterName) {
               // Render the 'indicator' template into the indicators element
               return Templates.renderIntoContainer('global_indicator', {name: filterName}, elem);
            });
         }
      };
   };
   return constructor;
});
