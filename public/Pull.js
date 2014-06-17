define(['Templates'], function(Templates) {
   var constructor = function(data) {
      _.extend(this, data);
   }

   _.extend(constructor.prototype, {
      remove: function() {
         this.element.remove();
      },
   update: function(data) {
      _.extend(this, data);

      var html = this.render();
      if (!this.element) {
         this.element = $(html);
         // For testing purposes, append to just one column
         $('#qaPulls').append(this.element);
      } else {
         this.element.html(html);
      }
   },
   render: function(templateName, object) {
      var template = Templates.get(templateName || 'pull');
      return template(object || this);
   }
   });

   return constructor;
});
