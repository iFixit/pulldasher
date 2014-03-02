module.exports = function PullManager() {
   var sockets = [];
   var pulls = [];

   function sendInitialData(socket) {
      socket.emit('fullData', _.invoke(pulls, 'toObject'));
   }

   function notifyAboutPullStateChange(pull) {
      sockets.forEach(function(socket) {
         socket.emit('pullChange', pull.toObject());
      });
   }

   /**
    * Removes the given socket from the collection
    */
   function removeSocket(socket) {
      var index = sockets.indexOf(socket);
      if (index !== null) {
         sockets.splice(index);
      }
   }

   return {
      addSocket: function(socket) {
         sockets.push(socket);
         sendInitialData(socket);
         socket.on('disconnect', function() {
            removeSocket(socket);
         });
      },

      addPull: function(pull) {
         pulls.push(pull);
         notifyAboutPullStateChange(pull);
      }
   };
}
