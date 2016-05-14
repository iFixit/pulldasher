// This file contains _page indicators_. What are page indicators? They're like
// indicators (`spec/indicators.js`), but act in summary on all the pulls in the
// page. They're rendered into the navbar by default, but just like normal
// indicators can also render themselves into matching elements. In the case of
// page indicators, the elements are searched against the entire body element.
//
// It is also worth noting that pageIndicators are run on the full list of
// pulls, even before the global filters (see `spec/index.js`). This enables
// them to do things like summarize the number of pulls which _aren't_ shown on
// the page.
define(['jquery', 'underscore', 'spec/utils', 'appearanceUtils'], function($, _, utils, aUtils) {
   // This function generates the data for the CR and QA leaderboards. There's a
   // known bug, however. When a pull is closed, the frontend doesn't discard
   // it. But on refresh, the frontend won't get it back. This function
   // (corrrectly) takes into account closed pulls, but we really need to be
   // getting some of them (maybe the last week's worth or so) from the backend
   // on startup.
   var summarize = function(pulls, node, type, extract) {
      // Clean out indicator node. This prevents re-renders from resulting in
      // junk.
      node.empty();

      var text = $('<div>');
      text.addClass('leaderboard-title');
      text.text(type + ' Leaderboard:');

      node.append(text);

      var date = new Date();
      var difference = 7 * 24 * 60 * 60 * 1000; // Two weeks in ms
      _.chain(pulls)
      .map(extract)
      .flatten()
      // We now have a list of signatures. Now to convert them to usernames
      .filter(function(signature) {
        return signature.data.active && (date - (new Date(signature.data.created_at))) < difference;
      })
      .map(function(signature) {
         return signature.data.user;
      })
      .groupBy("id")
      .map(function(group, id) {
         var instance = group[0];
         return {
            'id': id,
            'count': group.length,
            'username': instance.login
         };
      })
      .sortBy(function(item) {
         return -item.count;
      })
      .first(5)
      .each(function(user, i) {
         var info = $('<div>');
         info.addClass('leaderboard-posting');

         var count = $('<div>');
         count.addClass('leaderboard-count');
         count.text(user.count);

         var icon = aUtils.getAvatar(user.id);
         icon.addClass('leaderboard-avatar');

         info.append(count);
         info.append(icon);

         aUtils.addTooltip(info, user.username);

         if (i < 2) {
            // First two items
            info.addClass('leaderboard-leaders');
         } else if (i < 4) {
            // Next two items
            info.addClass('leaderboard-mid');
         } else {
            info.addClass('leaderboard-trailing');
         }

         node.append(info);
      });
   };
   return {
      pull_count: function(pulls, node) {
         pulls = pulls.filter(utils.shouldShowPull);
         node.text(pulls.length);
         node.wrapInner('<span class="number"></span>');
         node.append(' Open');
      },
      frozen_count: function(pulls, node) {
         var frozen = pulls.filter(function(pull) {
            return pull.hasLabel('Cryogenic Storage') && pull.state === 'open';
         });

         node.text(frozen.length);
         node.wrapInner('<span class="number"></span>');
         node.append(' Frozen');

         // If we have frozen pulls, make the count a link.
         if (frozen.length) {
            // Pull the repo and org from the first frozen pull.
            var repo = frozen[0].head.repo.name;
            var org = frozen[0].head.repo.owner.login;
            var label = 'Cryogenic Storage';
            var link = $('<a target="_blank" href="https://www.github.com/' + org + '/' + repo + '/labels/' + label + '"></a>');
            node.wrapInner(link);
         }
      },
      cr_leaderboard: function(pulls, node) {
         summarize(pulls, node, "CR", function(pull) {
            return pull.status.allCR;
         });
      },
      qa_leaderboard: function(pulls, node) {
         summarize(pulls, node, "QA", function(pull) {
            return pull.status.allQA;
         });
      }
   };
});
