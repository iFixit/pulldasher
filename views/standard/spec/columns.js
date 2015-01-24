define(['jquery', 'appearanceUtils'], function($, utils) {
   return [
      {
         title: "CI Blocked",
         id: "ciBlocked",
         selector: function(pull) {
            return !pull.dev_blocked() && (pull.build_failed() || (pull.cr_done() && pull.qa_done() && !pull.build_succeeded()));
         },
         sort: function(pull) {
            var score = 0;
            if (pull.is_mine()) {
               score -= 30;
            }

            score -= pull.status.CR.length * 1;
            score -= pull.status.QA.length * 2;

            if (!pull.build_failed()) {
               score += 15;
            }

            return score;
         },
         triggers: {
            onCreate: function(blob, container) {
               blob.removeClass('panel-default').addClass('panel-primary');
            },
            onUpdate: function(blob, container) {
               utils.hideIfEmpty(container, blob, '.pull');
            }
         },
         shrinkToButton: true
      },
      {
         title: "deploy_blocked Pulls",
         id: "deployBlockPulls",
         selector: function(pull) {
            return pull.ready() && pull.deploy_blocked();
         },
         triggers: {
            onCreate: function(blob, container) {
               blob.removeClass('panel-default').addClass('panel-primary');
            },
            onUpdate: function(blob, container) {
               utils.hideIfEmpty(container, blob, '.pull');
            }
         },
         shrinkToButton: true
      },
      {
         title: "Ready Pulls",
         id: "readyPulls",
         selector: function(pull) {
            return pull.ready() && !pull.deploy_blocked();
         },
         adjust: function(pull, node) {
            node.addClass('list-group-item-success');
         },
         triggers: {
            onCreate: function(blob, container) {
               blob.removeClass('panel-default').addClass('panel-primary');
            },
            onUpdate: function(blob, container) {
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
         },
         sort: function(pull) {
            var most_recent_block = pull.status.dev_block.slice(-1)[0].data;
            var date = new Date(most_recent_block.created_at);

            // Pulls that have been dev_blocked longer are higher priority.
            var score = -1/date.valueOf();

            if(pull.is_mine()) {
               score -= 1;
            }

            return score;
         },
         indicators: {
            actor: function actor(pull, node) {
               var current_block = pull.status.dev_block.slice(-1)[0].data;

               var date = new Date(current_block.created_at);

               var link = utils.getCommentLink(pull, current_block);

               var label = $('<span class="label label-default"></span>');

               label.text(utils.formatDate(date));
               link.append(label);
               utils.addActionTooltip(link, "dev_block'd",
               current_block.created_at, current_block.user.login);

               node.append(link);
            }
         }
      },
      {
         title: "CR Pulls",
         id: "crPulls",
         selector: function(pull) {
            return !pull.cr_done() && !pull.dev_blocked();
         },
         sort: function(pull) {
            if (pull.is_mine()) {
               return 3;
            } else if (pull.qa_done() && pull.build_succeeded()) {
               return 0;
            } else if (pull.qa_done()) {
               return 1;
            } else {
               return 2;
            }
         }
      },
      {
         title: "QA Pulls",
         id: "qaPulls",
         selector: function(pull) {
            return !pull.qa_done() && !pull.dev_blocked() &&
            !pull.build_failed();
         },
         sort: function(pull) {
            if (pull.is_mine()) {
               return 4;
            } else if (pull.cr_done() && pull.build_succeeded()) {
               return 0;
            } else if (pull.build_succeeded()) {
               return 1;
            } else if (pull.cr_done()) {
               return 2;
            } else {
               return 3;
            }
         },
         indicators: {
            qa_in_progress: function qa_in_progress(pull, node) {
               if (label = pull.getLabel('QAing')) {
                  var labelElem = $('<span>');
                  labelElem.addClass('warning glyphicon glyphicon-eye-open');
                  labelElem = utils.addActionTooltip(labelElem, '',
                  label.created_at, label.user);
                  node.append(labelElem);
               }
            }
         }
      }
      ];
   });
