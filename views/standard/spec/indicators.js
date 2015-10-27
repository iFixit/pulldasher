define(['jquery', 'underscore', 'appearanceUtils', 'debug'], function($, _, utils, debug) {
   var log = debug('indicators');
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
         };

         if (required === 0) {
            // Handle no-signature situation
            node.append(signatureValidMark());
            node.tooltip({'title': 'No ' + type + ' required!'});
            log("required === 0");
         } else {
            // container is a div that won't be inserted; it's just used to get the
            // HTML for the tooltip
            var tipper = $('<table>');
            var container = $('<div>');
            container.append(tipper);

            var currentSignatures = signatures.current;
            var oldSignatures = signatures.old;
            var userSignature = signatures.user;

            var tallies = 0;

            log("Tallies so far (should be 0):", tallies);
            log("Currently-valid signatures:", currentSignatures);
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
            log("Tallies so far:", tallies);

            log("Previously-valid signatures:", oldSignatures);
            if (oldSignatures.length > 0) {
               tipper.append(signatureSeparator('Prev signoff on'));

               log("Adding prev signoff section");
               if (tallies < required && userSignature && !userSignature.data.active) {
                  node.append(mySignatureInvalidatedMark());
                  tallies += 1;
               }
               log("Tallies so far:", tallies);

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
               log("Tallies so far:", tallies);
            }

            if (tallies === 0) {
               // There are no signatures of any type yet
               container.empty();
               var message = $('<span>');
               message.text('No signoffs yet!');
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

   // These are indicators. Each indicator is a function which will be called
   // for every pull. It is passed the Pull object (see `/public/js/Pull.js`)
   // and the HTML element into which it should render itself. That element can
   // come from one of two places: either it is an element in the pull HTML
   // template (see `html/pull.html`) or it is a new element placed in the
   // element in the pull template with class `indicators`. Basically, if
   // there's an element in the pull template with a class of the same name as
   // the indicator, then the indicator will be passed that element as the node
   // to render into.  Otherwise, a new element will be created. This makes it
   // really easy to add a basic tag on a bunch of pulls, should you wish to. An
   // example may help to make this all clearer: The `cr_remaining` indicator
   // below renders into the `div` with class `cr_remaining` in the pull
   // template (which is how the check marks for CR are implemented). On the
   // other hand, there's no element with class `custom_label`, so the
   // `custom_label` indicator below will be rrendered into a newly-created
   // element on each pull.

   // The indicators in this file will be called for every pull in every column,
   // so they add information that we want regardless of the column the pull is
   // in.
   return {
      cr_remaining: function cr_remaining(pull, node) {
         log("Working on CR on pull #" + pull.number);
         var required = pull.status.cr_req;
         signatureStatus(pull, node, 'CR', required, pull.cr_signatures);
      },

      qa_remaining: function qa_remaining(pull, node) {
         log("Working on QA on pull #" + pull.number);
         var required = pull.status.qa_req;
         signatureStatus(pull, node, 'QA', required, pull.qa_signatures);
      },
      build_status: function status(pull, node) {
         if (pull.status.commit_status) {
            var commit_status = pull.status.commit_status.data;
            var title = commit_status.description;
            var url   = commit_status.target_url;

            var corner = $('<div class="triangle"></div>');

            var link = $('<a target="_blank" class="build_status_link" data-toggle="tooltip" data-placement="top" title="' + title + '" href="' + url + '"></a>');
            var icon = $('<span>').addClass('status-icon glyphicon');

            node.append(link);
            link.append(corner);
            corner.append(icon);

            switch(commit_status.state) {
               case 'pending':
               corner.addClass('pending-triangle');
               icon.addClass('glyphicon-repeat');
               break;
               case 'success':
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
      milestone_label: function milestone_label(pull, node){
         var milestone = pull.milestone;

         if (!milestone) {
            return;
         }

         if (milestone.title) {
            var label = $('<span>').addClass('label label-info');
            var label_text = milestone.title;

            // If there's a due date, show that instead of the milestone title.
            if (milestone.due_on) {
               var date = new Date(milestone.due_on);
               label_text = (date.getMonth() + 1) + '/' + date.getDate();
               utils.addTooltip(label, milestone.title);
            }

            label.text(label_text);
            node.append(label);
         }
      },
      custom_label: function custom_label(pull, node) {
         var titles = pull.getLabelTitlesLike(/pulldasher-(.*)/);

         _.each(titles, function(title) {
            var label = $('<span>').addClass('label label-primary');
            label.text(title);
            node.append(label);
         });
      },

      // Here's an interesting duck! This indicator actually adds the event
      // handler to _the refresh button_ on each pull. If you look at the pull
      // template (`html/pull.html`), you'll see that the refresh button already
      // has its icon. This just adds the `click` event handler. Indicators are
      // super powerful!
      refresh: function(pull, node) {
         node.on('click', function(event) {
            event.preventDefault();
            pull.refresh();
         });
      }
   };
});
