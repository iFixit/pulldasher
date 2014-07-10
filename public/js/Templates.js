define(['underscore', 'text!html/pull.html', 'text!html/restore.html', 'text!html/column.html', 'text!html/indicator.html'],
function(_, pullTemplate, restoreTemplate, columnTemplate, indicatorTemplate){
   var templates = {
      pull: pullTemplate,
      restore: restoreTemplate,
      column: columnTemplate,
      indicator: indicatorTemplate
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
