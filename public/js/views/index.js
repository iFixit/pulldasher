define(['jquery', 'appearanceUtils'], function($, utils) {
   return {
      navbar: "#restore-buttons",
      page_indicator_box: "#global-indicators",
      page_indicators: {
         pull_count: function(pulls, node) {
            pulls = pulls.filter(function(pull) {
               return utils.shouldShowPull(pull);
            });
            node.text(pulls.length + " open pulls");
            node.wrapInner('<strong></strong>');
         },
         frozen_count: function(pulls, node) {
            var frozen = pulls.filter(function(pull) {
               return pull.hasLabel('Cryogenic Storage') && pull.state === 'open';
            });
            node.text(frozen.length + " frozen pulls");
            // If we have frozen pulls, make the count a link.
            if (frozen.length) {
               // Pull the repo and org from the first frozen pull.
               var repo = frozen[0].head.repo.name;
               var org = frozen[0].head.repo.owner.login;
               var label = 'Cryogenic Storage';
               var link = $('<a target="_blank" href="https://www.github.com/' + org + '/' + repo + '/labels/' + label + '"></a>');
               node.wrapInner(link);
            }
            node.wrapInner('<strong></strong>');
         }
      },
      // Global filters
      // where
      selector: function(pull) {
         return utils.shouldShowPull(pull);
      },
      // order by
      sort: function(pull) {
         return pull.created_at;
      },
      adjust: function(pull, node) {
         titleElem = node.find('.title');
         utils.addTooltip(titleElem, pull.author());
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
               node.append(utils.getAvatarDOMNode(pull, signature.data, "CR'd"));
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
               node.append(utils.getAvatarDOMNode(pull, signature.data, "QA'd"));
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
         },
         deploy_block: function deploy_block(pull, node) {
            if (pull.deploy_blocked()) {
               var current_block = pull.status.deploy_block.slice(-1)[0].data;
               var date = new Date(current_block.created_at);

               var link = utils.getCommentLink(pull, current_block);

               var label = $('<span class="label label-danger"></span>');

               label.text(utils.formatDate(date));
               link.append(label);
               utils.addActionTooltip(link, "deploy_block'd",
                current_block.created_at, current_block.user.login);

               node.append(link);
            }
         },
         custom_label: function custom_label(pull, node) {
            var titles = pull.getLabelTitlesLike(/pulldasher-(.*)/);

            _.each(titles, function(title) {
               var label = $('<span class="label label-primary"></span>');
               label.text(title);
               node.append(label);
            });
         }
      },
      columns: [
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
                     var labelElem = $('<span>' + label.title + '</span>');
                     labelElem.addClass('label label-warning');
                     labelElem = utils.addActionTooltip(labelElem, '',
                      label.created_at, label.user);

                     node.append(labelElem);
                  }
               }
            }
         }
      ]
   };
});
