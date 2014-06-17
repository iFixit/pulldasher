define(['underscore'], function(_){
   var templates = {
      pull: '\
      <a target="_blank" href="<%- pull.html_url %>" class="list-group-item">\
         <h4 class="list-group-item-heading">#<%- pull.number %> - <%- pull.title %></h4>\
      </a>'
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
   }
});
