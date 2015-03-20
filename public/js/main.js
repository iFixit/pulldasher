define(['jquery', 'underscore', 'pullManager', 'PullFilter', 'ElementFilter', 'Column', 'spec/index', 'IndicatorFilter', 'pageIndicatorHandler',
'ConnectionManager', 'bootstrap', 'refresh'],
// Note that not all of the required items above are represented in the
// function argument list. Some just need to be loaded, but that's all.
 function($, _, pullManager, PullFilter, ElementFilter, Column, spec, IndicatorFilter, PageIndicatorHandler) {
   var globalPullFilter = new PullFilter(spec);
   var globalElementFilter = new ElementFilter(spec);
   var globalIndicatorFilter = new IndicatorFilter(spec.indicators);

   var pageIndicatorHandler = new PageIndicatorHandler(spec.page_indicators, $(spec.page_indicator_box));

   // Handle page indicators
   pullManager.onUpdate(pageIndicatorHandler.handle);

   if (spec.debug_indicators) {
      var debugIndicatorHandler = new PageIndicatorHandler(spec.debug_indicators, $(spec.debug_indicator_box));

      pullManager.onUpdate(debugIndicatorHandler.handle);
   }

   _.each(spec.columns, function(columnSpec) {
      _.defaults(columnSpec, {
         navbar: spec.navbar
      });

      var pullFilter = new PullFilter(columnSpec);

      var elementFilter = new ElementFilter(columnSpec, globalElementFilter);
      var indicatorFilter = new IndicatorFilter(columnSpec.indicators, globalIndicatorFilter);

      var col = new Column(elementFilter, indicatorFilter, columnSpec);

      globalPullFilter.onUpdate(pullFilter.update);
      pullFilter.onUpdate(col.update);
   });

   pullManager.onUpdate(globalPullFilter.update);

   globalPullFilter.update(pullManager.getPulls());
});
