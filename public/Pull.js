define(['underscore'], function(_) {
   var constructor = function(data) {
      _.extend(this, data);
   };

   _.extend(constructor.prototype, {
      update: function(data) {
         _.extend(this, data);
      }
   });

   return constructor;
});
