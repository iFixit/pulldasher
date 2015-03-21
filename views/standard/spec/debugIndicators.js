define(['jquery', 'underscore', 'spec/utils', 'appearanceUtils', 'pullManager', 'socket'], function($, _, utils, aUtils, _manager, socket) {
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
      },

      offline: function(pulls, node) {
         var button = $('<span>');
         button.addClass('glyphicon glyphicon-plane');
         button.on('click', function() {
            if (App.airplane) {
               App.airplane = false;
               socket.emit('authenticate');
            } else {
               App.airplane = true;
            }

            button.toggleClass('text-primary');
         });

         if (App.airplane) {
            button.addClass('text-primary');
         }

         button.attr('title', 'Airplane mode');
         button.tooltip({'placement': 'auto top'});
         node.append(button);
      }
   };
});
