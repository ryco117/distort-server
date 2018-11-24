"use strict";
module.exports = function(app) {
  var authenticated = require('../controllers/authenticatedController')

  // Manage group membership
  app.use(authenticated.authenticate);
};
