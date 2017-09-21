import _ from 'underscore'

// These are various utility functions for the rest of the config.

// Get a `GET` parameter from the URL
var params = function() {
   var filters = {};
   var filterString = window.location.search;
   filterString = filterString.replace(/^\?/, '');
   var filterList = filterString.split('&');
   _.each(filterList, function(filter) {
      if (filter.length === 0) {
         return;
      }
      var pair = filter.split('=');
      var key = pair[0];
      // Decode value as needed
      var data = decodeURIComponent(pair[1]).split(',');
      filters[key] = data;
   });
   return filters;
};

export default {
   shouldShowPull: function(pull) {
      return pull.state === 'open' && !pull.hasLabel('Cryogenic Storage');
   },
   filterAuthors: function() {
      return params().assigned;
   },
   filterMilestones: function() {
      return params().milestone;
   }
};
