define(['underscore', 'text!html/pull.html', 'text!html/restore.html', 'text!html/column.html'],
function(_, pullTemplate, restoreTemplate, columnTemplate){
   var templates = {
      pull: pullTemplate,
      restore: restoreTemplate,
      column: columnTemplate
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
