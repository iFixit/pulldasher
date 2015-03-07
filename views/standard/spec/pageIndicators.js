define(['jquery', 'underscore', 'spec/utils', 'appearanceUtils'], function($, _, utils, aUtils) {
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
      var counts = _.chain(pulls)
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
            'username': instance.login,
            'realname': instance.realname
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
         node.text(pulls.length + " open pulls");
         node.wrapInner('<strong></strong>');
      },
      frozen_count: function(pulls, node) {
         var frozen = pulls.filter(function(pull) {
            return pull.hasLabel('Cryogenic Storage') && pull.state === 'open';
         });
         node.text(frozen.length + " frozen pulls");
         // If we have frozen pulls, make the count a link.
         if (frozen.length) {
            // Pull the repo and org from the first frozen pull.
            var repo = frozen[0].head.repo.name;
            var org = frozen[0].head.repo.owner.login;
            var label = 'Cryogenic Storage';
            var link = $('<a target="_blank" href="https://www.github.com/' + org + '/' + repo + '/labels/' + label + '"></a>');
            node.wrapInner(link);
         }
         node.wrapInner('<strong></strong>');
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
