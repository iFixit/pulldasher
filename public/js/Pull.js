define(['underscore'], function(_) {
   var constructor = function(data) {
      _.extend(this, data);
   };

   _.extend(constructor.prototype, {
      url: function() {
         return 'https://github.com/' + this.head.repo.owner.login + '/' + this.head.repo.name + '/pull/' + this.number;
      },

      update: function(data) {
         _.extend(this, data);
      },

      dev_blocked: function() {
         return this.status.dev_block.length > 0;
      },

      deploy_blocked: function() {
         return this.status.deploy_block.length > 0;
      },

      qa_done: function() {
         return this.status.QA.length >= this.status.qa_req;
      },

      cr_done: function() {
         return this.status.CR.length >= this.status.cr_req;
      },

      /**
       * Note that this is not the same as the "Ready" column: pulls which are
       * deploy_blocked return true for ready. It is, however, the base concept
       * on which both the "deploy_blocked" and "Ready" columns are based.
       */
      ready: function() {
         return !this.dev_blocked() && this.qa_done()
         && this.cr_done() && this.build_succeeded();
      },

      author: function() {
         return this.user.login;
      },

      is_mine: function() {
         return this.author() === App.user;
      },

      hasLabel: function(labelName) {
         return _.some(this.labels, function(label) {
            return label.title === labelName;
         });
      },

      getLabelTitlesLike: function(labelRegex) {
         var titles = _.map(this.labels, function(label) {
            var matches = label.title.match(labelRegex);
            return matches ? matches[1] : null;
         });

         return _.filter(titles, function(title) { return title; });
      },

      getLabel: function(labelName) {
         return _.findWhere(this.labels, {title: labelName});
      },

      has_status: function() {
         return !!this.status.commit_status;
      },

      build_status: function() {
         return this.has_status() && this.status.commit_status.data;
      },

      build_state: function() {
         return this.has_status() && this.build_status().state;
      },

      build_failed: function() {
         var state = this.build_state();
         return state == 'failure' || state == 'error';
      },

      build_succeeded: function() {
         return this.build_state() === 'success';
      },

      commit_status_url: function() {
         return this.has_status() ?
                this.build_status().target_url : '#';
      },
   });

   return constructor;
});
