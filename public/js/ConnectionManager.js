define(['jquery', 'underscore', 'socket'], function($, _, socket) {
   var events = {
      connect:          'connecting',
      connecting:       'connecting',
      reconnect:        'connected',
      reconnecting:     'connecting',
      disconnect:       'disconnected',
      connect_failed:   'disconnected',
      reconnect_failed: 'disconnected',
      error:            'disconnected',
      authenticated:    'connected'
   };
   _.each(events, function(newState, event) {
      socket.on(event, function() {
         console.log(new Date() + ": " + event);
         updateState(newState);
      });
   });

   function updateState(newState) {
      $('#connectionState').text(newState);
   }
});
