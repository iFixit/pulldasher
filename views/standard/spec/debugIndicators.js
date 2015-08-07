define(['jquery', 'underscore', 'spec/utils', 'appearanceUtils', 'pullManager', 'socket'], function($, _, utils, aUtils, _manager, socket) {
   // Don't show indicators if the debug setting is off.
   if (!App.debug)
      return;

   return {
      rerender: function(pulls, node) {
         var button = $('<span>');
         button.addClass('glyphicon glyphicon-blackboard');
         button.on('click', function() {
            _manager.trigger();
         });
         button.attr('title', 'Rerender page');
         button.tooltip({'placement': 'auto top'});
         node.append(button);
      },

      rendertime: function(pulls, node) {
         node.text((new Date()).toLocaleDateString('en-us', {'hour': 'numeric', 'minute': 'numeric', 'second': 'numeric'}));
         node.attr('title', 'Date of last rerender');
         node.tooltip({'placement': 'auto top'});
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
