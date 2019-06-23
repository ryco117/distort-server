"use strict";

const config = require('./config'),
  sjcl = require('./sjcl');

const DEBUG = config.debug;

exports.CERT_LENGTH =  14*24*3600*1000;   // 2 weeks
exports.PARANOIA = 8;

// Return string containing proper formatting of given peer
exports.formatPeerString = function(peerId, accountName) {
  return peerId + (!!accountName && accountName !== 'root' ? ':' + accountName : '');
}

// TODO: Include various verbosity levels to these debug print functions https://github.com/ryco117/distort-server/issues/13
// Print message to console.error if debugging is configured
exports.debugPrintError = function(msg) {
  if(DEBUG) {
    console.error('DEBUG-ERROR: ' + msg);
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
  err = (typeof err === 'string') ? err : ((err instanceof Error) ? err.message : String(err));
  exports.debugPrintError(err + " : " + statusCode);
  return res.json({'error': err});
}
// Send string as a message object
exports.sendMessageJSON = function(res, msg) {
  return res.json({'message': msg});
}

// SJCL Elliptic curve constants
exports.secp256k1 = sjcl.ecc.curves.k256;
