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

      is_mine: function() {
         return this.user.login === App.user;
      },

      build_status: function() {
         var status = this.status.commit_status;
         return status && status.data.state;
      },

      build_failed: function() {
         var status = this.build_status();
         return status == 'failure' || status == 'error';
      }
   });

   return constructor;
});
