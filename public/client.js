var socket = io.connect('/');

function Pull(data) {
   _.extend(this, data);
}

_.extend(Pull.prototype, {
   remove: function() {
      this.element.remove();
   },
   update: function(data) {
      _.extend(this, data);

      var html = this.render();
      console.log(html);
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

var pullManager = (function(socket) {
   var pullIndex = {};
   var pulls = [];

   socket.on('allPulls', function(pulls) {
      removeAll();
      updatePulls(pulls);
   });

   socket.on('pullChange', function(pull) {
      updatePulls([pull]);
   });

   function removeAll() {
      pulls.forEach(function(pull) {
         pull.remove();
      });
      pulls = [];
      pullIndex = {};
   }

   function updatePulls(pulls) {
      pulls.forEach(updatePull);
   }

   function updatePull(pullData) {
      var pull = getPull(pullData);
      pull.update();
   }

   function getPull(pullData) {
      return pullIndex[pullData.id] || createPull(pullData);
   }

   function createPull(pullData) {
      var pull = new Pull(pullData);
      pulls.push(pull);
      pullIndex[pull.id] = pull;
      return pull;
   }
})(socket);


(function ConnectionManager(socket) {
   var events = {
      connect:          'connecting',
      connecting:       'connecting',
      reconnect:        'connected',
      reconnecting:     'connecting',
      disconnect:       'disconnected',
      connect_failed:   'disconnected',
      reconnect_failed: 'disconnected',
      error:            'disconnected',
      authenticated:    'connected',
   }
   _.each(events, function(newState, event) {
      socket.on(event, function() {
         updateState(newState);
      });
   });

   function updateState(newState) {
      $('#connectionState').text(newState);
   }
})(socket);

(function Authenticator(socket) {
   socket.on('connect', function() {
      var token = App.socketToken;
      socket.emit('authenticate', token);
   });
})(socket);


var Templates = (function(){
   var templates = {
      pull: '\
      <a href="<%- pull.html_url %>" class="list-group-item">\
         <h4 class="list-group-item-heading">#<%= pull.number %> - <%= pull.title %></h4>\
         <p class="list-group-item-text"><%= pull.body %></p>\
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
})();
