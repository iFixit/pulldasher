define(['underscore'], function(_) {
   var constructor = function(data) {
      _.extend(this, data);
   };

   _.extend(constructor.prototype, {
      html_url: function() {
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
      }
   });

   return constructor;
});
