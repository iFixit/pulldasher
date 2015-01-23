define(['jquery', 'appearanceUtils', 'spec/pageIndicators', 'spec/indicators', 'spec/columns'], function($, utils, pageIndicators, indicators, columns) {
   return {
      navbar: "#restore-buttons",
      page_indicator_box: "#global-indicators",
      page_indicators: pageIndicators,
      // Global filters
      // where
      selector: function(pull) {
         return utils.shouldShowPull(pull);
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
