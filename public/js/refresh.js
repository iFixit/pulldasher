define(['socket'], function(socket) {
   $(document).on('click', '.refresh', function() {
      var number = $(this).attr('data-number');
      socket.emit('refresh', number);
      return false;
   });
});
