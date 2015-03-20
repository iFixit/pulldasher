define(['jquery', 'underscore', 'spec/utils', 'appearanceUtils', 'pullManager'], function($, _, utils, aUtils, _manager) {
   return {
      rerender: function(pulls, node) {
         var button = $('<button>Rerender</button>');
         button.on('click', function() {
            _manager.trigger();
         });
         node.append(button);
      },
      rendertime: function(pulls, node) {
         node.text(new Date());
         console.log("Last render: " + new Date());
      }
   };
});
