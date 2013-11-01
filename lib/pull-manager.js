module.exports = function PullManager() {
   var sockets = [];
   var pulls = [
      // dummy data for now
      {
         id: 1,
         name: "Pull #1",
         href: "https://github.com/chpatton013/pulldash",
         buildStatus: "success",
         buildLog: "https://google.com"
      }
   ];

   function sendInitialData(socket) {
      socket.emit('fullData', pulls);
   }

   function notifyAboutPullStateChange(pull) {
      sockets.forEach(function(socket) {
         socket.emit('pullChange', pull);
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
