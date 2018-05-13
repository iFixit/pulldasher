/*global module:false*/
module.exports = function(grunt) {

  // Project configuration.
  grunt.initConfig({
    // Task configuration.
    less: {
      options: {
        strictMath: true,
        outputSourceFiles: true
      },
      files: {
         src: [
            'views/current/less/*.less',
            'views/current/less/themes/*.less'
         ],
         expand: true,
         rename: function(dest, src) {
            return src.replace(/less/g, 'css');
         }
      }
      // END derived lines
    }
  });

  // These plugins provide necessary tasks.
  grunt.loadNpmTasks('grunt-contrib-less');

  // Default task.
  grunt.registerTask('default', ['less']);
};
