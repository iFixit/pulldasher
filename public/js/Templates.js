define(['underscore', 'text!pull.html', 'text!restore.html', 'text!column.html'],
function(_, pull, restore, column){
   var templates = {
      pull: pull,
      restore: restore,
      column: column
   };

   var compiledTemplates = {};

   return {
      get: function(name) {
         if (!compiledTemplates[name]) {
            compiledTemplates[name] = _.template(
               templates[name],
               null,
               { variable: name }
            );
         }
         return compiledTemplates[name];
      }
   };
});
