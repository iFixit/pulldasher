define(['socketjs'], function(io) {
   var socket = io.connect('/');

   socket.on('connect', function() {
      var token = socketToken;
      socket.emit('authenticate', token);
   });

   return socket;
});
