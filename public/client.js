var socket = io.connect('/');

function Pull(data) {
   _.extend(this, data);
}

_.extend(Pull.prototype, {
   remove: function() {
      if (this.element) {
         this.element.remove();
         delete this.element;
      }
   },
   update: function(data) {
      _.extend(this, data);

      if (this.state === 'open') {
         var html = this.render();
         if (!this.element) {
            this.element = $(html);
            // For testing purposes, append to just one column
            $('#qaPulls').append(this.element);
         } else {
            this.element.html(html);
         }
      } else { // this.state === 'closed'
         this.remove();
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
      updatePull(pull);
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
      pull.update(pullData);
   }

   function getPull(pullData) {
      return pullIndex[pullData.number] || createPull(pullData);
   }

   function createPull(pullData) {
      var pull = new Pull(pullData);
      pulls.push(pull);
      pullIndex[pull.number] = pull;
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
})();
