"use strict";
module.exports = function(app) {
  var authenticated = require('../controllers/authenticateAccountController')

  // Manage group membership
  app.use(authenticated.authenticate);
};
