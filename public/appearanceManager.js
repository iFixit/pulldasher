define(['jquery'], function ($) {
   return {
      /** Hides/shows `blob` depending on whether `container` has any elements in
       * it. If it doesn't, then `blob` will be hidden, and vice versa.
       *
       * Contract: Is passed two jQuery objects.
       */
      hideIfEmpty: function(container, blob) {
         if (container[0].hasChildNodes()) {
            blob.removeClass('hidden');
         } else {
            blob.addClass('hidden');
         }
      },

      updateCountBadges: function() {
         $('.pull-list').each(function() {
            var that = $(this);
            that.find('.pull-count').text(that.find('.list-group')[0].childNodes.length);
         });
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
      }
   };
});
