"use strict";

const config = require('./config');
const DEBUG = config.debug;

exports.formatPeerString = function(peerId, accountName) {
  return peerId + (!!accountName && accountName !== 'root' ? ':' + accountName : '');
}

// Send error JSON
exports.sendErrorJSON = function(res, err, statusCode) {
  res.status(statusCode);

  err = (typeof err === "string") ? err : (err.message || String(err));

  if(DEBUG) {
    console.error(err + " : " + statusCode);
  }

  return res.json({'error': err});
}
