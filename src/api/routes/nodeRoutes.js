"use strict";
module.exports = function(app) {
  var node = require('../controllers/nodeController');

  // Manage group membership
  app.route('/ipfs')
    .get(node.getIpfs);
};
