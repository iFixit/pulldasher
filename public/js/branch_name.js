define(['jquery'], function($) {
   var clipboard = $('<textarea>').attr('id', 'branch_name_clipboard');
   $('body').append(clipboard);

   $(document).on('mouseenter', '.pull', function() {
      var branch_name = $(this).attr('data-name');
      clipboard.val(branch_name).focus().select();
   });
});
