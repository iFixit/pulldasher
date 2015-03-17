define(['jquery', 'appearanceUtils'], function($, utils) {
   var signatureStatus = function(pull, node, type, required, signatures) {
         var signatureMark = function() {
            var check = $('<span>');
            check.addClass('signature glyphicon glyphicon-ok-sign');
            return check;
         };

         var signatureValidMark = function() {
            var check = signatureMark();
            check.addClass('signature-valid');
            return check;
         };

         var mySignatureValidMark = function() {
            var check = signatureMark();
            check.addClass('signature-valid-mine');
            return check;
         }

         var signatureInvalidatedMark = function() {
            var check = signatureMark();
            check.addClass('signature-invalid');
            return check;
         };

         var mySignatureInvalidatedMark = function() {
            var check = signatureMark();
            check.addClass('signature-invalid-mine');
            return check;
         };

         var signatureDescription = function(pull, signature) {
            var sig = $('<tr>');
            sig.addClass('sig-row');
            var avatarCell = $('<td>');
            avatarCell.addClass('sig-avatar');
            avatarCell.append(utils.getAvatar(signature.data.user.id));
            var info = $('<td>');
            info.addClass('sig-info');
            var date = new Date(signature.data.created_at);
            info.text(date.toLocaleDateString('en-us', {'month': 'short', 'day': 'numeric'}) + ' by ' + signature.data.user.login);

            sig.append(avatarCell);
            sig.append(info);
            return sig;
         };

         var validSignatureDescription = function(pull, signature) {
            var sig = signatureDescription(pull, signature);
            sig.addClass('signature-valid-listing');
            return sig;
         };

         var myValidSignatureDescription = function(pull, signature) {
            var sig = signatureDescription(pull, signature);
            sig.addClass('signature-valid-listing-mine');
            return sig;
         };

         var invalidSignatureDescription = function(pull, signature) {
            var sig = signatureDescription(pull, signature);
            sig.addClass('signature-invalid-listing');
            return sig;
         };

         var myInvalidSignatureDescription = function(pull, signature) {
            var sig = invalidSignatureDescription(pull, signature);
            sig.addClass('signature-invalid-listing-mine');
            return sig;
         };

         var signatureSeparator = function(message) {
               var divider = $('<tr>');
               var cell = $('<td>');
               cell.attr('colspan', 2);
               var text = $('<p>');
               text.text(message);
               var border = $('<div>');
               border.addClass("signature-separator");
               border.append(text);
               cell.append(border);
               cell.addClass('signature-divider');
               divider.append(cell);
               return divider;
         }

         var tallies = 0;
         var check;

         if (required === 0) {
            // Handle no-signature situation
            node.append(signatureValidMark());
            node.tooltip({'title': 'No ' + type + ' required!'});
         } else {
            // container is a div that won't be inserted; it's just used to get the
            // HTML for the tooltip
            var tipper = $('<table>');
            var container = $('<div>');
            container.append(tipper);

            currentSignatures = signatures.current;
            oldSignatures = signatures.old;
            userSignature = signatures.user;

            var i = 0;
            var signature;

            if (currentSignatures.length > 0) {
               tipper.append(signatureSeparator('Signoff on'));

               currentSignatures.forEach(function(signature) {
                  if (utils.mySig(signature)) {
                     tipper.append(myValidSignatureDescription(pull, signature));
                     node.append(mySignatureValidMark());
                  } else {
                     tipper.append(validSignatureDescription(pull, signature));
                     node.append(signatureValidMark());
                  }

                  tallies += 1;
               });
            }

            if (oldSignatures.length > 0) {
               tipper.append(signatureSeparator('Prev signoff on'));

               if (tallies < required && userSignature) {
                  node.append(mySignatureInvalidatedMark());
                  tallies += 1;
               }

               oldSignatures.forEach(function(signature) {
                  if (utils.mySig(signature)) {
                     tipper.append(myInvalidSignatureDescription(pull, signature));
                  } else {
                     tipper.append(invalidSignatureDescription(pull, signature));

                     // Only add checkmarks if we don't have enough already
                     if (tallies < required) {
                        node.append(signatureInvalidatedMark());
                        tallies += 1;
                     }
                  }
               });
            }

            if (tallies === 0) {
               // There are no signatures of any type yet
               container.empty();
               var message = $('<span>');
               message.text('No signoffs yet!')
               container.append(message);
            }

            for (; tallies < required; tallies++) {
               node.append(signatureMark());
            }

            // Set the tooltip to the combined contents of tipper
            node.tooltip({
               "html": true,
               // Derived from
               // https://github.com/twbs/bootstrap/issues/2091#issuecomment-4051978
               "title": container.html()
            });
         }
   };
   return {
      cr_remaining: function cr_remaining(pull, node) {
         var required = pull.status.cr_req;
         signatureStatus(pull, node, 'CR', required, pull.cr_signatures);
      },

      qa_remaining: function qa_remaining(pull, node) {
         var required = pull.status.qa_req;
         signatureStatus(pull, node, 'QA', required, pull.qa_signatures);
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
