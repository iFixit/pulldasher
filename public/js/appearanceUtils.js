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

      getAvatar: function(userid) {
         var avatar_url = 'https://avatars.githubusercontent.com/u/' + userid;
         var avatar = $('<img class="avatar">');
         avatar.attr('src', avatar_url);
         return avatar;
      },

      getCommentLink: function(pull, commentData) {
         var link =  $('<a target="_blank"></a>');
         var url = pull.url() + '#issuecomment-' + commentData.comment_id;
         link.attr('href', url);
         return link;
      },

      /**
       * Adds a tooltip containing information about an
       * action (such as CR or dev_block) on a pull. Does NOT activate the
       * tooltip; the user will need to call node.tooltip() to activate.
       */
      addActionTooltip: function(node, action, created_at, user) {
         var date = new Date(created_at);
         var info = action ? action + ' on ' : '';
         info += date.toLocaleDateString();
         info += user ? ' by ' + user : '';

         return this.addTooltip(node, info);
      },

      addTooltip: function(node, text) {
         node.attr('data-toggle', "tooltip");
         node.attr('data-placement', "top");
         node.attr('title', text);

         node.tooltip();
         return node;
      },

      /**
       * Formats a date to be the first three characters of the month followed
       * by the day of the month. (Ex. "Oct 6")
       */
      formatDate: function(date) {
         var matches = date.toString().match(/([A-Z][a-z]{2})\w* 0?(\d+)/);
         return matches[1] + " " + matches[2];
      }
   };
});
