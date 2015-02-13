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
            return check;
         };

         var signatureInvalidatedMark = function() {
            var check = signatureMark();
            check.addClass('signature-invalid');
            return check;
         };

         var mySignatureInvalidatedMark = function() {
            var check = signatureInvalidatedMark();
            check.addClass('mysig');
            return check;
         };

         var mySig = function(signature) {
            return signature.data.user.login === App.user;
         }

         var signatureDescription = function(pull, signature) {
            var sig = $('<tr>');
            var avatarCell = $('<td>');
            avatarCell.append(utils.getAvatarDOMNode(pull, signature.data, null));
            var info = $('<td>');
            var date = new Date(signature.data.created_at);
            info.text(date.toLocaleDateString() + ' by ' + signature.data.user.login);

            sig.append(avatarCell);
            sig.append(info);
            return sig;
         };

         var invalidSignatureDescription = function(pull, signature) {
            var sig = $('<tr>');
            sig.addClass('signature-invlid-listing');
            var avatarCell = $('<td>');
            avatarCell.append(utils.getAvatarDOMNode(pull, signature.data, null));
            var info = $('<td>');
            var date = new Date(signature.data.created_at);
            info.text(date.toLocaleDateString() + ' by ' + signature.data.user.login);

            sig.append(avatarCell);
            sig.append(info);
            return sig;
         };

         var tallies = 0;
         var check;

         if (required === 0) {
            // Handle no-signature situation
            node.append(signaturePresentMark());
            node.tooltip({'title': 'No ' + type + ' required!'});
         } else {
            // tipper is a div that won't be inserted; it's just used to get the
            // HTML for the tooltip
            var tipper = $('<table>');

            var users = {};
            var oldSignatures = false;
            signatures.forEach(function(signature) {
               if (signature.data.active) {
                  tipper.append(signatureDescription(pull, signature));

                  node.append(signaturePresentMark());
                  users[signature.data.user.id] = true;

                  tallies += 1;
               } else {
                  // If we don't have a signature for this user yet...
                  if (!users[signature.data.user.id]) {
                     // ...then we'll need to add invalidated signatures.
                     oldSignatures = true;
                  }
               }
            });

            if (oldSignatures) {
               var divider = $('<tr>');
               var cell = $('<td>');
               cell.attr('colspan', 2);
               cell.text('Prev. SO');
               divider.append(cell);
               tipper.append(divider);

               signatures.forEach(function(signature) {
                  if (!users[signature.data.user.id]) {
                     tipper.append(invalidSignatureDescription(pull, signature));

                     if (tallies < required) {
                        // Only add the checks if we still need more review
                        if (mySig(signature)) {
                           node.append(mySignatureInvalidatedMark());
                        } else {
                           node.append(signatureInvalidatedMark());
                        }
                     }

                     users[signature.data.user.id] = true;

                     tallies += 1;
                  }
               });
            }


            for (; tallies < required; tallies++) {
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
         var signatures = pull.status.allCR;
         signatureStatus(pull, node, 'CR', required, signatures);
      },

      qa_remaining: function qa_remaining(pull, node) {
         var required = pull.status.qa_req;
         var signatures = pull.status.allQA;
         signatureStatus(pull, node, 'QA', required, signatures);
      },
      build_status: function status(pull, node) {
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
   };
});
