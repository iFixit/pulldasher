define(['underscore', 'socket', 'Pull'], function(_, socket, Pull) {

   var pullIndex = {};
   var pulls = [];

   socket.on('allPulls', function(pulls) {
      removeAll();
      updatePulls(pulls);
   });

   socket.on('pullChange', function(pull) {
      updatePull(pull);
   });

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

});
