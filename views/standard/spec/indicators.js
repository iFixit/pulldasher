define(['jquery', 'appearanceUtils'], function($, utils) {
   return {
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

            var corner = $('<div class="triangle"></div>');

            var link = $('<a target="_blank" class="status" data-toggle="tooltip" data-placement="top" title="' + title + '" href="' + url + '"></a>');
            var icon = $('<span class="status-icon glyphicon"></span>');

            node.append(link);
            link.append(corner);
            corner.append(icon);

            switch(commit_status.state) {
               case 'pending':
               corner.addClass('pending-triangle');
               icon.addClass('glyphicon-repeat');
               break;
               case 'success':
               corner.addClass('success-triangle');
               icon.addClass('glyphicon-ok');
               break;
               case 'error':
               corner.addClass('error-triangle');
               icon.addClass('glyphicon-exclamation-sign');
               break;
               case 'failure':
               corner.addClass('warning-triangle');
               icon.addClass('glyphicon-remove');
               break;
            }

            link.tooltip();
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
   };
});
