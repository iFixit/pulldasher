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
            indicatorFilter.filter(pulls, $('body'), function(elem, filterName) {
               // elem will be the body tag. We'll ignore in in here.
               // Render the 'global_indicator' template into the indicators element
               return Templates.renderIntoContainer('global_indicator', {name: filterName}, indicatorContainer);
               // Notice that we render using the indicatorContainer as the
               // holder. That's because that's where autocreated indicators
               // are supposed to be rendered into
            });
         }
      };
   };
   return constructor;
});
