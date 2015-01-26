define(['jquery', 'appearanceUtils'], function($, utils) {
   return {
      pull_count: function(pulls, node) {
         pulls = pulls.filter(function(pull) {
            return utils.shouldShowPull(pull);
         });
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
      }
   };
});
