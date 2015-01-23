define(['jquery', 'appearanceUtils', 'views/pageIndicators', 'views/columns'], function($, utils, pageIndicators, columns) {
   return {
      navbar: "#restore-buttons",
      page_indicator_box: "#global-indicators",
      page_indicators: pageIndicators,
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
         titleElem = node.find('.pull-title');
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
      columns: columns
   };
});
