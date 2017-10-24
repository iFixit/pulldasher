import io from 'socket.io-client'

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

export default socket;
