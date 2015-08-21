define(['jquery', 'appearanceUtils'], function($, utils) {
   return [
      {
         title: "CI Blocked",
         id: "ciBlocked",
         selector: function(pull) {
            return !pull.dev_blocked() && !pull.build_succeeded();
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
         indicators: {
            deploy_block: function deploy_block(pull, node) {
               if (pull.deploy_blocked()) {
                  var current_block = pull.status.deploy_block.slice(-1)[0].data;
                  var date = new Date(current_block.created_at);
                  var link = utils.getCommentLink(pull, current_block);
                  var label = $('<span>').addClass('label label-danger');

                  label.text(utils.formatDate(date));
                  link.append(label);
                  utils.addActionTooltip(link, "deploy_block'd",
                  current_block.created_at, current_block.user.login);

                  node.append(link);
               }
            },
         },
         shrinkToButton: true
      },
      {
         title: "Ready Pulls",
         id: "readyPulls",
         selector: function(pull) {
            return pull.ready() && !pull.deploy_blocked();
         },
         triggers: {
            onCreate: function(blob, container) {
               blob.removeClass('panel-default').addClass('panel-success');
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

               var label = $('<span>').addClass('label label-default');

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
            // The higher score is, the lower the pull will be sorted.
            // So a lower score means an item shows higher in the list.
            var score = 0;

            var signatures = pull.cr_signatures;

            if (!pull.cr_done() && signatures.user && !signatures.user.data.active) {
               // The user has an invalid signature, and the pull isn't ready.
               // They should re-CR it
               score -= 1000;
            }

            if (!signatures.user && (signatures.old.length + signatures.current.length) >= pull.status.cr_req) {
               // The number of people who've messed with the pull is at least
               // the number of people who need to sign off, and I'm not one of them.
               score += 500;
            }

            if (signatures.user && signatures.user.data.active) {
               // I've already CRd or QAd this pull
               score += 1000;
            }

            if (pull.is_mine()) {
               score += 500;
            }

            if (pull.build_succeeded()) {
               score -= 4;
            }

            if (pull.qa_done()) {
               score -= 2;
            }

            score -= pull.status.CR.length;

            return score;
         },
      },
      {
         title: "QA Pulls",
         id: "qaPulls",
         selector: function(pull) {
            return !pull.qa_done() && !pull.dev_blocked() &&
             pull.build_succeeded();
         },
         sort: function(pull) {
            // The higher score is, the lower the pull will be sorted.
            // So a lower score means an item shows higher in the list.
            var score = 0;

            var signatures = pull.qa_signatures;

            if (!pull.qa_done() && signatures.user && !signatures.user.data.active) {
               // The user has an invalid signature, and the pull isn't ready.
               // They should re-QA it
               score -= 1000;
            }

            if (!signatures.user && (signatures.old.length + signatures.current.length) >= pull.status.qa_req) {
               // The number of people who've messed with the pull is at least
               // the number of people who need to sign off, and I'm not one of them.
               score += 500;
            }

            if (signatures.user && signatures.user.data.active) {
               // I've already CRd or QAd this pull
               score += 1000;
            }

            var label = pull.getLabel('QAing');

            if (label) {
               if (label.user === App.user) {
                  score -= 750;
               } else {
                  score += 500;
               }
            }

            if (pull.is_mine()) {
               score += 500;
            }

            if (pull.build_succeeded()) {
               score -= 2;
            }

            if (pull.cr_done() ||
            (pull.cr_signatures.old.length + pull.cr_signatures.current.length) >= pull.status.cr_req) {
               // If the pull is CR-complete or the pull has enough invalid and
               // current CRs to become complete, push it up.
               score -= 1;
            }

            return score;
         },
         indicators: {
            qa_in_progress: function qa_in_progress(pull, node) {
               var label;
               if ((label = pull.getLabel('QAing'))) {
                  var labelElem = $('<span>' + label.title + '</span>');
                  var labelclass;
                  if (label.user === App.user) {
                     labelclass = 'label-success';
                  } else {
                     labelclass = 'label-warning';
                  }
                  labelElem.addClass('label ' + labelclass);
                  labelElem = utils.addActionTooltip(labelElem, '',
                  label.created_at, label.user);

                  node.append(labelElem);
               }
            }
         }
      }
      ];
   });
