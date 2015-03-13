define(function() {
   return {
      shouldShowPull: function(pull) {
         return pull.state === 'open' && !pull.hasLabel('Cryogenic Storage');
      }
   };
});
