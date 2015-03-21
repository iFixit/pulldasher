define(['socketjs'], function(io) {
   var socket = io.connect('/');

   socket.on('unauthenticated', function() {
      if (!App.airplane) {
         window.location.reload();
      }
   });

   socket.on('connect', function() {
      var token = App.socketToken;
      socket.emit('authenticate', token);
   });

   return socket;
});
