import $ from 'jquery'
import utils from 'appearanceUtils'
import _ from 'underscore'

/* `spec/columns.js`
 *
 * This file defines the columns which Pulldasher shows. It is required and
 * slotted into the global config by `spec/main.js`.
 */

// Sorting functions that are run on each column.
var globalSorts = {
   sortByMilestone: function(pull) {
      if (!pull.milestone.due_on) {
         return 0;
      }

      var milestone = new Date(pull.milestone.due_on);
      var timeDiff = milestone.getTime() - $.now();

      return -1000 + Math.ceil(timeDiff / (1000 * 3600 * 24));
   },
   sortOwnerFirst: function(pull) {
      return pull.is_mine() ? -5000 : 0;
   }
};

/**
 * Runs all of the functions from globalSorts on the given pull and reduces
 * each score into a total sorting score.
 */
function sortGlobally(pull) {
   return _.reduce(globalSorts, function(score, sort) {
      return score + sort(pull);
   }, 0);
}

// This array will contain one object for each column configured. Adding a
// column requires adding a new element to the array and adding a spot on
// index.html for the column to go in.
export default [
   // This object describes a column in Pulldasher, specifically, the CI
   // Blocked column.
   {
      // This name will be displayed at the top of the column.
      title: "CI Blocked",
      // This id is used to match the column to the element it should be
      // placed in. Pulldasher will render the column into an element with id
      // `<id>-container`. So, for example, this column will render into the
      // `ciBlocked-container` element in `index.js`.
      id: "ciBlocked",
      // This describes how to choose the pulls to go in this column. It is a
      // function which returns `true` if a pull should go in the column and
      // `false` otherwise. This property may also be an array of functions,
      // in which case the selectors are chained.
      selector: function(pull) {
         return !pull.dev_blocked() && !pull.build_succeeded();
      },
      // This describes the sort order for the pull. It returns a numeric
      // score for each pull. Pulls with a low score are sorted to the bottom
      // of the column. Pulls with a high score are sorted to the top.
      sort: function(pull) {
         var score = sortGlobally(pull);
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
      // Triggers provide hooks to run your own javascript on a column at
      // various points in the column's lifecycle. Each function is passed
      // two arguments: the column's main element and the column's container
      // element. The function may do anything it likes.
      triggers: {
         // This hook will be run on column creation. In this case, it sets
         // the nice blue color on the column header.
         onCreate: function(blob) {
            blob.removeClass('panel-default').addClass('panel-primary');
         },
         // This hook will be run whenever Pulldasher receives an update from
         // the server. It should typically be used to update things about
         // the column's appearance that are affected by its contents (or, in
         // this case, lack thereof).
         onUpdate: function(blob, container) {
            utils.hideIfEmpty(container, blob, '.pull');
         }
      },
      // This is a magical option (in a bad way) which makes the column
      // collapsible. It would be better if no more such options were added.
      shrinkToButton: false
      // Take a look at the next column for more on the parts we haven't seen
      // yet!
   },
   {
      title: "Deploy Blocked Pulls",
      id: "deployBlockPulls",
      selector: function(pull) {
         return pull.ready() && pull.deploy_blocked();
      },
      triggers: {
         onCreate: function(blob) {
            blob.removeClass('panel-default').addClass('panel-primary');
         },
         onUpdate: function(blob, container) {
            utils.hideIfEmpty(container, blob, '.pull');
         }
      },
      indicators: {
         deploy_block: function deploy_block(pull, node) {
            if (pull.deploy_blocked()) {
               var current_block = pull.status.deploy_block.slice(-1)[0].data;
               var link = utils.getCommentLink(pull, current_block);
               var icon = $('<i>').addClass('fa fa-warning deploy-blocked');

               link.append(icon);
               utils.addActionTooltip(icon, "Deploy Blocked",
               current_block.created_at, current_block.user.login);

               node.append(link);
            }
         }
      },
      shrinkToButton: false
   },
   {
      title: "Ready Pulls",
      id: "readyPulls",
      selector: function(pull) {
         return pull.ready() && !pull.deploy_blocked();
      },
      triggers: {
         onCreate: function(blob) {
            blob.removeClass('panel-default').addClass('panel-success');
         },
         onUpdate: function(blob, container) {
            utils.hideIfEmpty(container, blob, '.pull');
         }
      },
      shrinkToButton: false
   },
   {
      title: "Dev Blocked Pulls",
      id: "blockPulls",
      selector: function(pull) {
         return pull.dev_blocked();
      },
      sort: function(pull) {
         var most_recent_block = pull.status.dev_block.slice(-1)[0].data;
         var date = new Date(most_recent_block.created_at);
         var score = sortGlobally(pull);

         // Pulls that have been dev_blocked longer are higher priority.
         score += -1/date.valueOf();

         if (pull.is_mine()) {
            score -= 1;
         }

         return score;
      },
      indicators: {
         actor: function actor(pull, node) {
            var current_block = pull.status.dev_block.slice(-1)[0].data;
            var link = utils.getCommentLink(pull, current_block);
            var icon = $('<i>').addClass('fa fa-minus-circle dev-blocked');

            link.append(icon);
            utils.addActionTooltip(icon, "Dev Blocked",
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
         // The higher score is, the lower the pull will be sorted.
         // So a lower score means an item shows higher in the list.
         var score = sortGlobally(pull);
         var signatures = pull.cr_signatures;

         if (!pull.cr_done() && signatures.user && !signatures.user.data.active) {
            // The user has an invalid signature, and the pull isn't ready.
            // They should re-CR it
            score -= 1000;
         }

         if (!signatures.user && (signatures.old.length + signatures.current.length) >= pull.status.cr_req) {
            // The number of people who've messed with the pull is at least
            // the number of people who need to sign off, and I'm not one of them.
            score += 500;
         }

         if (signatures.user && signatures.user.data.active) {
            // I've already CRd or QAd this pull
            score += 1000;
         }

         if (pull.is_mine()) {
            score += 500;
         }

         if (pull.build_succeeded()) {
            score -= 4;
         }

         if (pull.qa_done()) {
            score -= 2;
         }

         score -= pull.status.CR.length;

         return score;
      }
   },
   {
      title: "QA Pulls",
      id: "qaPulls",
      selector: function(pull) {
         return !pull.qa_done() && !pull.dev_blocked() &&
          pull.build_succeeded();
      },
      sort: function(pull) {
         // The higher score is, the lower the pull will be sorted.
         // So a lower score means an item shows higher in the list.
         var score = sortGlobally(pull);
         var signatures = pull.qa_signatures;

         if (!pull.qa_done() && signatures.user && !signatures.user.data.active) {
            // The user has an invalid signature, and the pull isn't ready.
            // They should re-QA it.
            score -= 1000;
         }

         if (!signatures.user && (signatures.old.length + signatures.current.length) >= pull.status.qa_req) {
            // The number of people who've messed with the pull is at least
            // the number of people who need to sign off, and I'm not one of them.
            score += 500;
         }

         if (signatures.user && signatures.user.data.active) {
            // I've already CRd or QAd this pull.
            score += 1000;
         }

         var label = pull.getLabel('QAing');

         if (label) {
            if (label.user === App.user) {
               score -= 750;
            } else {
               score += 500;
            }
         }

         if (pull.is_mine()) {
            score += 500;
         }

         if (pull.build_succeeded()) {
            score -= 2;
         }

         if (pull.cr_done() ||
         (pull.cr_signatures.old.length + pull.cr_signatures.current.length) >= pull.status.cr_req) {
            // If the pull is CR-complete or the pull has enough invalid and
            // current CRs to become complete, push it up.
            score -= 1;
         }

         var extBlockLabel = pull.getLabel('external_block');

         if (extBlockLabel) {
            score += 2000;
         }

         return score;
      },
      indicators: {
         qa_in_progress: function qa_in_progress(pull, node) {
            var label;
            if ((label = pull.getLabel('QAing'))) {
               const icon = $('<i>').addClass('fa fa-eye qaing');
               if (label.user === App.user) {
                  icon.addClass('mine');
               }
               utils.addActionTooltip(icon, 'QA started',
                label.created_at, label.user);
               node.append(icon);
            }
            if ((label = pull.getLabel('external_block'))) {
               const icon = $('<i>').addClass('fa fa-eye-slash externally-blocked');

               utils.addActionTooltip(icon, 'Externally Blocked',
                label.created_at, label.user);
               node.append(icon);
            }
         }
      }
   }
];
