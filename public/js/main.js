define(['jquery', 'underscore', 'pullManager', 'PullFilter', 'ElementFilter', 'Column', 'views/index',
'ConnectionManager', 'bootstrap'],
// Note that not all of the required items above are represented in the
// function argument list. Some just need to be loaded, but that's all.
 function($, _, pullManager, PullFilter, ElementFilter, Column, spec) {
   var globalPullFilter = new PullFilter(spec);
   var globalElementFilter = new ElementFilter(spec);

   _.each(spec.columns, function(columnSpec) {
      _.defaults(columnSpec, {
         navbar: spec.navbar
      });
      var pullFilter = new PullFilter(columnSpec);
      var elementFilter = new ElementFilter(columnSpec, globalElementFilter);
      var col = new Column(elementFilter, columnSpec);

      globalPullFilter.onUpdate(pullFilter.update);
      pullFilter.onUpdate(col.update);
   });

   pullManager.onUpdate(globalPullFilter.update);

   globalPullFilter.update(pullManager.getPulls());
});
