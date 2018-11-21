"use strict";
module.exports = function(app) {
  var distort = require('../controllers/distortController');

  // Manage group membership
  app.route('/groups')
    .get(distort.listGroups)
    .post(distort.addGroup);

  // Manage activity within a group
  app.route('/groups/:groupName')
    .get(distort.readMissedMessages)
    .put(distort.postMessage)
    .delete(distort.leaveGroup);
};
