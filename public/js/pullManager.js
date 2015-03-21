define(['underscore', 'socket', 'Pull'], function(_, socket, Pull) {
   var listeners = [];

   var pullIndex = {};
   var pulls = [];

   var throttledUpdate = _.throttle(update, 500);

   socket.on('allPulls', function(pulls) {
      if (!App.airplane) {
         removeAll();
         updatePulls(pulls);

         update();
      }
   });

   socket.on('pullChange', function(pull) {
      if (!App.airplane) {
         updatePull(pull);

         throttledUpdate();
      }
   });

   function update() {
      _.each(listeners, function(listener) {
         listener(pulls);
      });
   }

   function removeAll() {
      pulls.forEach(function(pull) {
         pull.remove();
      });
      pulls = [];
      pullIndex = {};
   }

   function updatePulls(pulls) {
      pulls.forEach(updatePull);
   }

   function updatePull(pullData) {
      var pull = getPull(pullData);
      pull.update(pullData);
   }

   function getPull(pullData) {
      return pullIndex[pullData.number] || createPull(pullData);
   }

   function createPull(pullData) {
      var pull = new Pull(pullData);
      pulls.push(pull);
      pullIndex[pull.number] = pull;
      return pull;
   }

   return {
      onUpdate: function(listener) {
         listeners.push(listener);
      },

      getPulls: function() {
         return pulls;
      },

      trigger: function() {
         update();
      }
   };
});
