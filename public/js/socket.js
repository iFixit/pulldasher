define(['socketjs'], function(io) {
   var socket = io.connect('/');
   var serverVersion;

   socket.on('versioncode', function(versioncode) {
      if (serverVersion === undefined) {
         serverVersion = versioncode;
      } else if (serverVersion !== versioncode) {
         window.location.reload();
      }
   });

   socket.on('connect', function() {
      var token = App.socketToken;
      socket.emit('authenticate', token);
   });

   return socket;
});
