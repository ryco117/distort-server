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

  // Fetch messages from a group in given range
  app.route('/groups/:groupName/:indexStart/:indexEnd')
    .get(distort.readMessagesInRange);

  // Manage accounts
  app.route('/account')
    .get(distort.fetchAccount);
    //.post()
    //.delete()
};
