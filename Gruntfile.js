/*global module:false*/
module.exports = function(grunt) {

  // The following lines are derived from Bootstrap's Gruntfile:
  /*!
   * Bootstrap's Gruntfile
   * http://getbootstrap.com
   * Copyright 2013-2015 Twitter, Inc.
   * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
   */
  var getLessVarsData = function () {
    var filePath = path.join(__dirname, 'less/variables.less');
    var fileContent = fs.readFileSync(filePath, { encoding: 'utf8' });
    var parser = new BsLessdocParser(fileContent);
    return { sections: parser.parseFile() };
  };
  // END derived lines

  // Project configuration.
  grunt.initConfig({
    // Task configuration.
    jshint: {
      options: {
        curly: true,
        eqeqeq: true,
        immed: true,
        latedef: true,
        newcap: true,
        noarg: true,
        sub: true,
        undef: true,
        unused: true,
        boss: true,
        eqnull: true,
        browser: true,
        globals: {
          jQuery: true
        }
      },
      gruntfile: {
        src: 'Gruntfile.js'
      },
      lib_test: {
        src: ['public/**/*.js', 'views/current/spec/**/*.js']
      }
    },
    less: {
      // The following lines are derived from Bootstrap's Gruntfile:
      /*!
       * Bootstrap's Gruntfile
       * http://getbootstrap.com
       * Copyright 2013-2015 Twitter, Inc.
       * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
       */
      options: {
        strictMath: true,
        outputSourceFiles: true
      },
      file: {src: 'views/current/less/main.less', dest: 'views/current/css/pulldasher.css'}
      // END derived lines
    }
  });

  // These plugins provide necessary tasks.
  grunt.loadNpmTasks('grunt-contrib-less');
  grunt.loadNpmTasks('grunt-contrib-jshint');

  // Default task.
  grunt.registerTask('default', ['less']);

};