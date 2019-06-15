"use strict";
module.exports = function(app) {
  var node = require('../controllers/accountlessRequestController');

  // Manage group membership
  app.route('/ipfs')
    .get(node.getIpfs);

  // Allow callers offering a signed account name to create an account
  app.route('/create-account')
    .post(node.createAccount);
};
