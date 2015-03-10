define(['underscore', 'appearanceUtils'], function(_, utils) {
   var constructor = function(data) {
      _.extend(this, data);

      var computeSignatures = function(signatures) {
         var table = {};
         var users = {};

         // Contains all signatures that are active
         table.currentSignatures = [];
         // Contains all signatures that are inactive from users without signatures in currentSignatures
         table.oldSignatures = [];
         // Contains the most recent signature from the current user
         table.userSignature = null;

         signatures.forEach(function(signature) {
            if (signature.data.active) {
               table.currentSignatures.push(signature);
               users[signature.data.user.id] = true;

               if (utils.mySig(signature)) {
                  table.userSignature = signature;
               }
            } else if (!users[signature.data.user.id]) {
               table.oldSignatures.push(signature);
               users[signature.data.user.id] = true;

               if (utils.mySig(signature)) {
                  table.userSignature = signature;
               }
            }
         });

         return table;
      }

      this.cr_signatures = computeSignatures(this.status.allCR);
      this.qa_signatures = computeSignatures(this.status.allQA);
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
