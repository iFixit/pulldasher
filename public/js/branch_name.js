define(['jquery'], function($) {
   $(document).on('click', '.branch_name', function() {
      var branch_name = $(this).attr('data-name');
      prompt("Copy this dialog:", branch_name);
      return false;
   });
});
