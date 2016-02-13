// This defines the debug indicators. These are a group of indicators on the
// right-hand side of the navbar which are only visible in debugging mode. In
// general, these should work the same way as page indicators (see
// `spec/pageIndicators.js`).
//
// See the views README (`/views/README.md`) for more on activating debug mode.
define(['jquery', 'underscore', 'spec/utils', 'appearanceUtils', 'pullManager', 'socket', 'debug'], function($, _, utils, aUtils, _manager, socket, debug) {
   var log = debug('pulldasher:debug-indicators');
   var whenDebug = function(f) {
      // This function will run f if App.debug is true. f will be passed any
      // arguments to this function
      return function() {
         // Don't show indicators if the debug setting is off.
         if (!App.debug) {
            return;
         }
         f.apply(this, arguments);
      };
   };
   return {
      // Allows the user to rerender all the pulls. This does the same thing
      // that happens when the server sends an update to a pull, but it doesn't
      // change the pull data at all, making it easier to trigger a debugger as
      // needed.
      rerender: whenDebug(function(pulls, node) {
         var button = $('<span>');
         button.addClass('glyphicon glyphicon-blackboard');
         button.on('click', function() {
            _manager.trigger();
         });
         button.attr('title', 'Rerender page');
         button.tooltip({'placement': 'auto top'});
         node.append(button);
      }),

      // This displays the last time the page was rerendered. It makes it easier
      // to track when renders are happening. Note that it doesn't use any
      // special hooks or anything, it just shows the date when it was last
      // rerendered.
      rendertime: whenDebug(function(pulls, node) {
         node.text((new Date()).toLocaleDateString('en-us', {'hour': 'numeric', 'minute': 'numeric', 'second': 'numeric'}));
         node.attr('title', 'Date of last rerender');
         node.tooltip({'placement': 'auto top'});
         log("Last render: " + new Date());
      }),

      // Allows the user to disable all the actions that happen when the server
      // sends an update. This doesn't actually pause updates from the server,
      // it just makes the places that receive them into noops. Thus, it's a bit
      // of a hack, and it has to refresh the page upon deactivation in order to
      // ensure it's got up-to-date data.
      offline: whenDebug(function(pulls, node) {
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
      })
   };
});
