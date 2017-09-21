import $ from 'jquery'
import _ from 'underscore'
import utils from 'appearanceUtils'
import specUtils from 'spec/utils'
import pageIndicators from 'spec/pageIndicators'
import indicators from 'spec/indicators'
import columns from 'spec/columns'
import debugIndicators from 'spec/debugIndicators'

// This is the main spec file for Pulldasher. In reality, it's the only spec
// file. The others are being required (see immediately below) and stuck in
// their respective places in the overall config.
// define(['jquery', 'underscore', 'appearanceUtils', 'spec/utils', 'spec/pageIndicators', 'spec/indicators', 'spec/columns', 'spec/debugIndicators'],
// function($, _, utils, specUtils, pageIndicators, indicators, columns, debugIndicators) {
   var clipboard = $('#branch_name_clipboard');
   export default {
      navbar: "#restore-buttons",
      page_indicator_box: "#global-indicators",
      page_indicators: pageIndicators,
      debug_indicator_box: "#debug-indicators",
      debug_indicators: debugIndicators,
      // Global filters: These are used to set which pulls should show on the
      // page at all. Notice that you're allowed to use multiple
      // functions here, as in all the other selector filters. See
      // `spec/columns.js` for more on filters.
      selector: [
         function(pull) {
            return specUtils.shouldShowPull(pull);
         },
         function(pull) {
            var authors = specUtils.filterAuthors();
            if (!authors || authors.length === 0) {
               return true;
            }
            return _.contains(authors, pull.author());
         },
         function(pull) {
            var milestones = specUtils.filterMilestones();
            if (!milestones || milestones.length === 0) {
               return true;
            }
            if (pull.milestone) {
               return _.contains(milestones, pull.milestone.title);
            }
         }
      ],
      // order by
      sort: function(pull) {
         return pull.created_at;
      },
      // This provides a hook to make modifications to each pull as it's
      // rendered.
      adjust: function(pull, node) {
         var titleElem = node.find('.pull-title');
         utils.addTooltip(titleElem, pull.author());

         node.on('mouseenter', function() {
            clipboard.val(pull.head.ref).focus().select();
         });
      },
      // Functions to stick status information in indicators at the bottom of
      // each pull.
      indicators: indicators,
      columns: columns
   };
// });
