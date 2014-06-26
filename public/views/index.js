define(['jquery'], function($) {
   return {
      // where
      selector: function(pull) {
         return true;
      },
      // order by
      sort: function(pull) {
         return pull.created_at;
      },
      // Allows custom modifications of each pull's display
      adjust: function(pull, node) {
         // If the pull is over 30 days old...
         if (Date.now() - (new Date(pull.created_at)) > 2590000000 ) {
            // Mark it in red
            $(node).addClass('bg-warning');
         }
      },
      navbar: "#restore-buttons",
      columns: [
         {
            title: "Special Pulls",
            id: "uniqPulls",
            selector: function(pull) {
               return (pull.deploy_blocked() || pull.status.ready) && !pull.dev_blocked();
            },
            sort: function(pull) {
               return pull.deploy_blocked() ? 0 : 1;
            },
            adjust: function(pull, node) {
               if (pull.deploy_blocked()) {
                  $(node).addClass('bg-warning');
               }
            },
            triggers: {
               onCreate: function(blob, container, utils) {
                  blob.removeClass('panel-default').addClass('panel-primary');
               },
               onUpdate: function(blob, container, utils) {
                  utils.hideIfEmpty(container, blob, '.pull');
               }
            },
            shrinkToButton: true
         },
         {
            title: "dev_blocked Pulls",
            id: "blockPulls",
            selector: function(pull) {
               return pull.dev_blocked();
            }
         },
         {
            title: "CR Pulls",
            id: "crPulls",
            selector: function(pull) {
               return !pull.cr_done() && !pull.dev_blocked();
            }
         },
         {
            title: "QA Pulls",
            id: "qaPulls",
            selector: function(pull) {
               return !pull.qa_done() && !pull.dev_blocked();
            }
         }
      ]
   };
});
