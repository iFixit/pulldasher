import $ from 'jquery'
import _ from 'underscore'
import utils from 'spec/utils'
import aUtils from 'appearanceUtils'
import _manager from 'pullManager'
import socket from 'socket'
import debug from 'debug'
import bootstrap from 'bootstrap'

// This defines the debug indicators. These are a group of indicators on the
// right-hand side of the navbar which are only visible in debugging mode. In
// general, these should work the same way as page indicators (see
// `spec/pageIndicators.js`).
//
// See the views README (`/views/README.md`) for more on activating debug mode.

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

export default {
   // Allows the user to rerender all the pulls. This does the same thing
   // that happens when the server sends an update to a pull, but it doesn't
   // change the pull data at all, making it easier to trigger a debugger as
   // needed.
   rerender: whenDebug(function(pulls, node) {
      var button = $('<i>');
      button.addClass('fa fa-paint-brush');
      button.on('click', function() {
         _manager.trigger();
      });
      button.attr('title', 'Rerender page. Last rendered: ' + (new Date())
       .toLocaleDateString('en-us', {'hour': 'numeric', 'minute': 'numeric', 'second': 'numeric'}));
      button.tooltip({'placement': 'auto top'});
      node.append(button);
   }),

   // Allows the user to disable all the actions that happen when the server
   // sends an update. This doesn't actually pause updates from the server,
   // it just makes the places that receive them into noops. Thus, it's a bit
   // of a hack, and it has to refresh the page upon deactivation in order to
   // ensure it's got up-to-date data.
   offline: whenDebug(function(pulls, node) {
      var button = $('<i>');
      button.addClass('fa fa-plane');
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
