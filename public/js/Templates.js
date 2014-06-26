define(['underscore'], function(_){
   var templates = {
      pull: '\
      <a target="_blank" href="<%- pull.url() %>" class="list-group-item pull">\
         <h4 class="list-group-item-heading">#<%- pull.number %> - <%- pull.title %></h4>\
      </a>',

      restore: '<button class="btn btn-primary navbar-btn" style="display: none" type="button">\
            <%- restore.title %>\
            <span class="pull-count badge"></span>\
      </button>',

      column: '\
      <div class="panel panel-default pull-list">\
            <div class="panel-heading" data-toggle="collapse" data-target="#<%- column.id %>">\
               <h1 class="panel-title">\
                  <%- column.title %>\
                  <span class="pull-count badge pull-right"></span>\
               </h1>\
            </div>\
         <div id="<%- column.id %>" class="list-group collapse in"></div>\
      </div>'
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
