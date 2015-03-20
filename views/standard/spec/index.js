define(['jquery', 'appearanceUtils', 'spec/utils', 'spec/pageIndicators', 'spec/indicators', 'spec/columns', 'spec/debugIndicators'], function($, utils, specUtils, pageIndicators, indicators, columns, debugIndicators) {
   return {
      navbar: "#restore-buttons",
      page_indicator_box: "#global-indicators",
      page_indicators: pageIndicators,
      debug_indicator_box: "#debug-indicators",
      debug_indicators: debugIndicators,
      // Global filters
      // where
      selector: function(pull) {
         return specUtils.shouldShowPull(pull);
      },
      // order by
      sort: function(pull) {
         return pull.created_at;
      },
      adjust: function(pull, node) {
         titleElem = node.find('.pull-title');
         utils.addTooltip(titleElem, pull.author());
      },
      // Functions to stick status information in indicators at the bottom of each pull
      indicators: indicators,
      columns: columns
   };
});
