define(['jquery', 'underscore', 'pullManager', 'appearanceManager', 'module', 'PullFilter', 'ElementFilter', 'Column', 'ConnectionManager'],
 function($, _, pullManager, appearanceManager, module, PullFilter, ElementFilter, Column, ConnectionManager) {
   var spec = View;


   var globalPullFilter = new PullFilter(spec);
   var globalElementFilter = new ElementFilter(spec);

   _.each(spec.columns, function(columnSpec) {
      var pullFilter = new PullFilter(columnSpec);
      var elementFilter = new ElementFilter(columnSpec, globalElementFilter);
      var col = new Column(elementFilter, columnSpec);

      globalPullFilter.onUpdate(pullFilter.update);
      pullFilter.onUpdate(col.update);
   });

   pullManager.onUpdate(globalPullFilter.update);

   //$(appearanceManager.addCollapseSwaps);
   
   globalPullFilter.update(pullManager.getPulls());
});
