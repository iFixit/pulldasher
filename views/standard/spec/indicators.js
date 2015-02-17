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

         var mySig = function(signature) {
            return signature.data.user.login === App.user;
         }

         var signatureDescription = function(pull, signature) {
            var sig = $('<tr>');
            var avatarCell = $('<td>');
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

         var tallies = 0;
         var check;

         if (required === 0) {
            // Handle no-signature situation
            node.append(signatureValidMark());
            node.tooltip({'title': 'No ' + type + ' required!'});
         } else {
            // tipper is a div that won't be inserted; it's just used to get the
            // HTML for the tooltip
            var tipper = $('<table>');
            var container = $('<div>');
            container.append(tipper);

            var users = {};

            // Contains all signatures that are active
            var currentSignatures = [];
            // Contains all signatures that are inactive from users without signatures in currentSignatures
            var oldSignatures = [];
            // Contains the most recent signature from the current user
            var userSignature = null;

            var sigCount = 0;

            signatures.forEach(function(signature) {
               if (signature.data.active) {
                  currentSignatures.push(signature);
                  users[signature.data.user.id] = true;
                  sigCount += 1;
               } else if (!users[signature.data.user.id]) {
                  oldSignatures.push(signature);
                  users[signature.data.user.id] = true;
                  sigCount += 1;

                  if (!userSignature && mySig(signature)) {
                     userSignature = mySig;
                  }
               }
            });

            var i = 0;
            var signature;

            currentSignatures.forEach(function(signature) {
               tipper.append(validSignatureDescription(pull, signature));

               node.append(signatureValidMark());
               tallies += 1;
            });

            if (oldSignatures.length > 0) {
               var divider = $('<tr>');
               var cell = $('<td>');
               cell.attr('colspan', 2);
               cell.text('PREV. SO');
               cell.addClass('signature-divider');
               divider.append(cell);
               tipper.append(divider);

               if (tallies < required && userSignature) {
                  node.append(mySignatureInvalidatedMark());
                  tallies += 1;
               }

               oldSignatures.forEach(function(signature) {
                  if (mySig(signature)) {
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

            for (; tallies < required; tallies++) {
               node.append(signatureMark());
            }

            if (sigCount > 0) {
               // Set the tooltip to the combined contents of tipper
               node.tooltip({
                  "html": true,
                  // Derived from
                  // https://github.com/twbs/bootstrap/issues/2091#issuecomment-4051978
                  "title": container.html()
               });
            }
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
