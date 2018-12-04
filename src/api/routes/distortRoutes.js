"use strict";
module.exports = function(app) {
  var distort = require('../controllers/distortController');

  // Manage group membership
  app.route('/groups')
    .get(distort.listGroups)
    .post(distort.addGroup);

  // Manage activity within a group
  app.route('/groups/:groupName')
    .get(distort.fetchConversations)
    .put(distort.postMessage)
    .delete(distort.leaveGroup);

  // Fetch messages from a group in given range
  app.route('/groups/:groupName/:indexStart/:indexEnd')
    .get(distort.readConversationMessagesInRange);
  app.route('/groups/:groupName/:indexStart')
    .get(distort.readConversationMessagesInRange);

  // Manage accounts
  app.route('/account')
    .get(distort.fetchAccount);
    // TODO: Allow 'root' account to manage other accounts
    //.post()
    //.delete()

  // TODO: Allow to set certain account parameters ('enabled', 'activeGroup', etc)
  /*app.route('/account/set/')
    .put();*/

  app.route('/peers')
    .get(distort.fetchPeers)
    .post(distort.addPeer)
    .delete(distort.removePeer);
};
