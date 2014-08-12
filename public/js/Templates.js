define([ 'jquery',
         'underscore',
         'text!html/ci_build.html',
         'text!html/pull.html',
         'text!html/restore.html',
         'text!html/column.html',
         'text!html/indicator.html',
         'text!html/global_indicator.html'],
function($,
         _,
         ciBuildTemplate,
         pullTemplate,
         restoreTemplate,
         columnTemplate,
         indicatorTemplate,
         globalIndicatorTemplate){

   var templates = {
      ci_build: ciBuildTemplate,
      pull: pullTemplate,
      restore: restoreTemplate,
      column: columnTemplate,
      indicator: indicatorTemplate,
      global_indicator: globalIndicatorTemplate
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
      },
      /**
       * Renders a template with provided data and appends the resulting node
       * to the end of the JQuery object container.
       *
       * @return Returns a jQuery object representing the result of the render.
       */
      renderIntoContainer: function renderInto(template, data, container) {
         var templateFunction = this.get(template);
         var html = templateFunction(data);
         var node = $(html);
         container.append(node);

         return node;
      }
   };
});
