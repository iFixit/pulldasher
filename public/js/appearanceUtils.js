define(['jquery'], function ($) {
   return {
      /** Hides/shows `blob` depending on whether `container` has any elements
       * matching `selector` in it. If it doesn't, then `blob` will be hidden,
       * and vice versa.
       *
       * @param selector The selector to use to find child nodes
       *
       * Contract: Is passed two jQuery objects.
       */
      hideIfEmpty: function(container, blob, selector) {
         if (container.find(selector).length > 0) {
            if (blob.hasClass('hidden')) {
               blob.removeClass('hidden');
            }
         } else {
            // Don't add an extra class if it's already there.
            if (!blob.hasClass('hidden')) {
               blob.addClass('hidden');
            }
         }
      },

      addCollapseSwaps: function() {
         var uniq = $('#uniqSect');
         var restore = $('#uniqRestore');
         uniq.on('hidden.bs.collapse', function() {
            uniq.fadeOut();
            restore.fadeIn();
         });
         restore.on('click', function() {
            restore.fadeOut();
            uniq.fadeIn();
            $('#uniqPulls').collapse('show');
         });
      },

      getAvatarDOMNode: function(username, userid) {
               var avatar_url = 'https://avatars.githubusercontent.com/u/' + userid;
               var avatar = $('<img data-toggle="tooltip" data-placement="top" class="avatar">');
               avatar.attr('src', avatar_url);
               avatar.attr('title', username);
               avatar.tooltip();
               return avatar;
      }
   };
});
