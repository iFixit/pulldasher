define(['socketjs'], function(io) {
   var socket = io.connect('/');

   $(document).on('click', '.refresh', function() {
      var number = $(this).attr('data-number');
      socket.emit('refresh', number);
      return false;
   });
});
