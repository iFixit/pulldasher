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

      is_mine: function() {
         return this.user.login === App.user;
      },

      hasLabel: function(labelName) {
         return _.some(this.labels, function(label) {
            return label.title === labelName;
         });
      },

      getLabel: function(labelName) {
         return _.findWhere(this.labels, {title: labelName});
      },

      build_status: function() {
         var status = this.status.commit_status;
         return status && status.data.state;
      },

      build_failed: function() {
         var status = this.build_status();
         return status == 'failure' || status == 'error';
      },

      build_succeeded: function() {
         return this.build_status() === 'success';
      }
   });

   return constructor;
});
