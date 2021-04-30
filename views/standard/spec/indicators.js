import $ from 'jquery'
import _ from 'underscore'
import utils from 'appearanceUtils'
import debug from 'debug'

var log = debug('indicators');
var signatureStatus = function(pull, node, type, required, signatures) {
      var signatureMark = function() {
         return $('<i>').addClass('signature fa fa-check-circle');
      };

      var signatureValidMark = function() {
         return signatureMark().addClass('signature-valid');
      };

      var mySignatureValidMark = function() {
         return signatureMark().addClass('signature-valid-mine');
      };

      var signatureInvalidatedMark = function() {
         return signatureMark().addClass('signature-invalid');
      };

      var mySignatureInvalidatedMark = function() {
         return signatureMark().addClass('signature-invalid-mine');
      };

      var signatureDescription = function(pull, signature) {
         var sig = $('<tr>').addClass('sig-row');
         var avatarCell = $('<td>').
          addClass('sig-avatar').
          append(utils.getAvatar(signature.data.user.id));
         var info = $('<td>').addClass('sig-info');

         var date = new Date(signature.data.created_at);
         info.text(utils.formatDate(date) + ' by ' +
          signature.data.user.login);

         return sig.append(avatarCell).append(info);
      };

      var validSignatureDescription = function(pull, signature) {
         return signatureDescription(pull, signature).
          addClass('signature-valid-listing');
      };

      var myValidSignatureDescription = function(pull, signature) {
         return signatureDescription(pull, signature).
          addClass('signature-valid-listing-mine');
      };

      var invalidSignatureDescription = function(pull, signature) {
         return signatureDescription(pull, signature).
          addClass('signature-invalid-listing');
      };

      var myInvalidSignatureDescription = function(pull, signature) {
         return invalidSignatureDescription(pull, signature).
          addClass('signature-invalid-listing-mine');
      };

      var signatureSeparator = function(message) {
         var text = $('<p>').text(message);
         var border = $('<div>').
          addClass("signature-separator").
          append(text);
         var cell = $('<td>').
          attr('colspan', 2).
          append(border).
          addClass('signature-divider');

         return $('<tr>').append(cell);
      };

      if (required === 0) {
         // Handle no-signature situation
         node.addClass('full-valid').
          append(signatureValidMark()).
          tooltip({'title': 'No ' + type + ' required!'});
         log("required === 0");
      } else {
         // container is a div that won't be inserted; it's just used to get the
         // HTML for the tooltip
         var tipper = $('<table>');
         var container = $('<div>').append(tipper);

         var currentSignatures = signatures.current;
         var oldSignatures = signatures.old;
         var userSignature = signatures.user;

         var tallies = 0,
             valid = 0,
             invalid = 0,
             myValid = 0,
             myInvalid = 0;

         log("Tallies so far (should be 0):", tallies);
         log("Currently-valid signatures:", currentSignatures);
         if (currentSignatures.length > 0) {
            tipper.append(signatureSeparator('Signoff on'));

            currentSignatures.forEach(function(signature) {
               if (utils.mySig(signature)) {
                  tipper.append(myValidSignatureDescription(pull, signature));
                  node.append(mySignatureValidMark());
                  myValid += 1;
               } else {
                  tipper.append(validSignatureDescription(pull, signature));
                  node.append(signatureValidMark());
               }

               tallies += 1;
               valid += 1;
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
               invalid += 1;
               myInvalid += 1;
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
                     invalid += 1;
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
         } else if (valid + invalid >= required) {
            if (invalid === 0) {
               node.addClass(myValid > 0 ?
                'full-valid-mine' : 'full-valid');
            } else if (valid === 0) {
               node.addClass(myInvalid > 0 ?
                'full-invalid-mine' : 'full-invalid');
            } else {
               node.addClass('full-mix');

               if (myValid > 0) {
                  node.addClass('myValid');
               }

               if (myInvalid > 0) {
                  node.addClass('myInvalid');
               }
            }
         }

         for (; tallies < required; tallies++) {
            node.append(signatureMark());
         }

         // Set the tooltip to the combined contents of tipper
         node.tooltip({
            sanitize: false,
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
export default {
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
      const statuses = pull.status.commit_statuses;
      if (statuses && statuses.length) {
         const statusContainer = $('<div class="build_status_container"></div>');
         const sortedStatuses = statuses.sort(compareByContext);
         statusContainer.append(sortedStatuses.map((status) => {
            const commit_status = status.data;
            const title = commit_status.description;
            const url   = commit_status.target_url;

            const link = $('<a target="_blank" class="build_status_link" data-toggle="tooltip" data-placement="top"></a>');
            link.attr('href', url);
            link.attr('title', commit_status.context + ": " + title);
            link.addClass('build-state-' + commit_status.state);
            link.tooltip();
            return link;
         }));

         node.append(statusContainer);
      }
   },
   user_icon: function user_icon(pull, node) {
      if (pull.is_mine()) {
         node.append('<i class="fa fa-star"></i>');
      }
   },
   milestone_label: function milestone_label(pull, node){
      var milestone = pull.milestone;

      if (!milestone) {
         return;
      }

      if (milestone.title) {
         var flag = $('<i>').addClass('fa fa-flag');
         var tooltip_text = milestone.title;

         // If there's a due date, show that instead of the milestone title.
         if (milestone.due_on) {
            var date = new Date(milestone.due_on);
            var past_due = date.getTime() < Date.now();

            if (past_due) {
               flag.addClass('flag-past-due');
               tooltip_text = "Past Due: " + tooltip_text;
            } else {
               flag.addClass('flag-milestone');
            }
         }

         utils.addTooltip(flag, tooltip_text);
         node.append(flag);
      }
   },
   custom_label: function custom_label(pull, node) {
      var titles = pull.getLabelTitlesLike(/pulldasher-(.*)/);

      _.each(titles, function(title) {
         var tag = $('<i>').addClass('fa fa-tag');
         utils.addTooltip(tag, title);
         node.append(tag);
      });
   },
   age: function age(pull, node) {
      const timeDifference = Date.now() - new Date(pull.created_at).getTime();
      const daysSinceCreation = Math.ceil(timeDifference / (1000 * 3600 * 24));
      const numDots = Math.min(daysSinceCreation, 20);
      const dot = "•";
      const daysInDots = dot.repeat(numDots);
      const severityColor  = getAgeColor(daysSinceCreation);

      var ageContainer = $(`<div class="age_container" style="color:${severityColor}">${daysInDots}</div>`);
      utils.addTooltip(ageContainer, `Age: ${daysSinceCreation}`);
      node.append(ageContainer);
   },

   // Here's an interesting duck! This indicator actually adds the event
   // handler to _the refresh button_ on each pull. If you look at the pull
   // template (`html/pull.html`), you'll see that the refresh button already
   // has its icon. This just adds the `click` event handler. Indicators are
   // super powerful!
   refresh: function(pull, node) {
      utils.addTooltip(node, 'Refresh #' + pull.number, "left");
      node.on('click', function(event) {
         event.preventDefault();
         pull.refresh();
      });
   }
};

function getAgeColor(days) {
   switch (Math.floor(days / 3)) {
      case 0: return 'green';
      case 1: return '#fabd02';
      case 2: return 'orange';
      default: return 'red';
   }
}

function compareByContext(statusA, statusB) {
   if (statusA.data.context < statusB.data.context) {
     return -1;
   }
   if (statusA.data.context > statusB.data.context) {
     return 1;
   }
   return 0;
}
