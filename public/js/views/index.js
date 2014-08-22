define(['jquery', 'appearanceUtils'], function($, utils) {
   return {
      navbar: "#restore-buttons",
      page_indicator_box: "#global-indicators",
      page_indicators: {
         pull_count: function(pulls, node) {
            node.text(pulls.length + " open pulls");
            node.wrapInner('<strong></strong>');
         }
      },
      // Global filters
      // where
      selector: function(pull) {
         return pull.state === 'open';
      },
      // order by
      sort: function(pull) {
         return pull.created_at;
      },
      // Allows custom modifications of each pull's display
      adjust: function(pull, node) {
         if (pull.deploy_blocked()) {
            // Mark it in red
            node.addClass('list-group-item-danger');
         }
      },
      // Functions to stick status information in indicators at the bottom of each pull
      indicators: {
         cr_remaining: function cr_remaining(pull, node) {
            var required = pull.status.cr_req;
            var completed = pull.status.CR.length;

            var text = $('<p class="sig-count">CR ' + completed + '/' + required + '</p>');

            node.append(text);

            if (completed >= required) {
               text.addClass('text-success');
            }

            pull.status.CR.forEach(function(signature) {
               var user = signature.data.user;
               node.append(utils.getAvatarDOMNode(user.login, user.id));
            });
         },
         qa_remaining: function qa_remaining(pull, node) {
            var required = pull.status.qa_req;
            var completed = pull.status.QA.length;

            var text = $('<p class="sig-count">QA ' + completed + '/' + required + '</p>');

            node.append(text);

            if (completed >= required) {
               text.addClass('text-success');
            }

            pull.status.QA.forEach(function(signature) {
               var user = signature.data.user;
               node.append(utils.getAvatarDOMNode(user.login, user.id));
            });
         },
         status: function status(pull, node) {
            if (pull.status.commit_status) {
            var commit_status = pull.status.commit_status.data;
               var title = commit_status.description;
               var url   = commit_status.target_url;
               var state = commit_status.state;

               var link = $('<a target="_blank" data-toggle="tooltip" data-placement="top" title="' + title + '" href="' + url + '"></a>');
               node.append(link);
               link.tooltip();
               switch(commit_status.state) {
                  case 'pending':
                  link.append('<span class="text-muted glyphicon glyphicon-repeat"></span>');
                  break;
                  case 'success':
                  link.append('<span class="text-success glyphicon glyphicon-ok"></span>');
                  break;
                  case 'error':
                  link.append('<span class="text-danger glyphicon glyphicon-exclamation-sign"></span>');
                  break;
                  case 'failure':
                  link.append('<span class="text-warning glyphicon glyphicon-remove"></span>');
                  break;
               }
            }
         },
         user_icon: function user_icon(pull, node) {
            if (pull.is_mine()) {
               node.append('<span class="glyphicon glyphicon-user"></span>');
            }
         }
      },
      columns: [
         {
            title: "CI Unsuccessful",
            id: "ciUnsuccessful",
            selector: function(pull) {
               return pull.build_failed() && !pull.dev_blocked();
            },
            sort: function(pull) {
               var score = 0;
               if (pull.is_mine()) {
                  score -= 15;
               }

               score -= pull.status.CR.length * 1;
               score -= pull.status.QA.length * 2;

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
               return pull.is_mine() ? 0 : 1;
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
               } else if (pull.qa_done() && pull.build_status() === 'success') {
                  return 0;
               } else if (pull.qa_done()) {
                  return 1;
               } else {
                  return 2;
               }
            },
            indicators: {
               cr_remaining: function(pull, node) {
                  var required = pull.status.cr_req;
                  var remaining = required - pull.status.CR.length;
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
               } else if (pull.cr_done() && pull.build_status() === 'success') {
                  return 0;
               } else if (pull.build_status() === 'success') {
                  return 1;
               } else if (pull.cr_done()) {
                  return 2;
               } else {
                  return 3;
               }
            },
            indicators: {
               qa_remaining: function(pull, node) {
                  var required = pull.status.qa_req;
                  var remaining = required - pull.status.QA.length;
               }
            }
         }
      ]
   };
});
