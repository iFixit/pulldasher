define(['socketjs'], function(io) {
   var socket = io.connect('/');
   var versionCode;

   socket.on('versioncode', function(serverVersion) {
      if (versionCode === undefined) {
         versionCode = serverVersion
      } else if (versionCode !== serverVersion) {
         window.location.reload();
      }
   });

   socket.on('connect', function() {
      var token = App.socketToken;
      socket.emit('authenticate', token);
   });

   return socket;
});
