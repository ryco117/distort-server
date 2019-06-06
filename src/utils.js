"use strict";

const config = require('./config');
const DEBUG = config.debug;

// Return string containing proper formatting of given peer
exports.formatPeerString = function(peerId, accountName) {
  return peerId + (!!accountName && accountName !== 'root' ? ':' + accountName : '');
}

// TODO: Include various verbosity levels to these debug print functions https://github.com/ryco117/distort-server/issues/13
// Print message to console.error if debugging is configured
exports.debugPrintError = function(msg) {
  if(DEBUG) {
    console.error('DEBUG: ' + msg);
  }
}
// Print message to console.log if debugging is configured
exports.debugPrint = function(msg) {
  if(DEBUG) {
    console.log('DEBUG: ' + msg);
  }
}

// Send error JSON
exports.sendErrorJSON = function(res, err, statusCode) {
  res.status(statusCode);
  err = (typeof err === "string") ? err : (err.message || String(err));
  exports.debugPrintError(err + " : " + statusCode);
  return res.json({'error': err});
}
// Send string as a message object
exports.sendMessageJSON = function(res, msg) {
  return res.json({'message': msg});
}
