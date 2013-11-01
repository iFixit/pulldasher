var config = require('../config'),
    passport = require('../lib/authentication');

module.exports = function(app) {
   app.get('/auth/github', passport.authenticate('github'));
   app.get('/auth/github/callback',
      passport.authenticate('github', { failureRedirect: '/auth' }),
      function (req, res) {
         res.redirect('/');
      });

   // Ensure ALL other routes are authenticated
   app.all("/*", function (req, res, next) {
      if (req.isAuthenticated()) { return next(); }
      res.redirect('/auth/github');
   });
}
