define(['jquery', 'appearanceUtils'], function($, utils) {
   var signatureStatus = function(pull, node, type, required, signatures) {
         var signatureMark = function() {
            var check = $('<span>');
            check.addClass('signature glyphicon glyphicon-ok-sign');
            return check;
         };

         var signaturePresentMark = function() {
            var check = signatureMark();
            check.addClass('signature-complete');
            return check
         };

         var signatureDescription = function(pull, signature) {
            var sig = $('<tr>');
            var avatarCell = $('<td>');
            avatarCell.append(utils.getAvatarDOMNode(pull, signature.data, type + "'d"));
            var info = $('<td>');
            var date = new Date(signature.data.created_at);
            info.text(date.toLocaleDateString() + ' by ' + signature.data.user.login);

            sig.append(avatarCell);
            sig.append(info);
            return sig;
         };

         var completed = signatures.length;
         var check;

         if (required == 0) {
            // Handle no-signature situation
            node.append(signaturePresentMark());
            node.tooltip({'title': 'No ' + type + ' required!'});
         } else {
            // tipper is a div that won't be inserted; it's just used to get the
            // HTML for the tooltip
            var tipper = $('<table>');

            signatures.forEach(function(signature) {
               tipper.append(signatureDescription(pull, signature));

               node.append(signaturePresentMark());
            });

            for (var i = 0; i < (required - completed); i++) {
               node.append(signatureMark());
            }

            // Set the tooltip to the combined contents of tipper
            node.tooltip({
               "html": true,
               // Derived from
               // https://github.com/twbs/bootstrap/issues/2091#issuecomment-4051978
               "title": tipper.html()
            });
         }
   };
   return {
      cr_remaining: function cr_remaining(pull, node) {
         var required = pull.status.cr_req;
         var signatures = pull.status.CR;
         signatureStatus(pull, node, 'CR', required, signatures);
      },

      qa_remaining: function qa_remaining(pull, node) {
         var required = pull.status.qa_req;
         var signatures = pull.status.QA;
         signatureStatus(pull, node, 'QA', required, signatures);
      },
      build_status: function status(pull, node) {
         if (pull.status.commit_status) {
            var commit_status = pull.status.commit_status.data;
            var title = commit_status.description;
            var url   = commit_status.target_url;
            var state = commit_status.state;

            var corner = $('<div class="triangle"></div>');

            var link = $('<a target="_blank" class="build_status_link" data-toggle="tooltip" data-placement="top" title="' + title + '" href="' + url + '"></a>');
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
