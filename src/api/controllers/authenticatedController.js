"use strict";

var sjcl = require('../../sjcl'),
  distort_ipfs = require('../../distort-ipfs'),
  config = require('../../config'),
  utils = require('../../utils'),
  mongoose = require('mongoose'),
  Account = mongoose.model('Accounts');

const sendErrorJSON = utils.sendErrorJSON;
const formatPeerString = utils.formatPeerString;
const debugPrint = utils.debugPrint;

// Retrieve messages for the specified group
exports.authenticate = function(req, res, next) {
  debugPrint('params: ' + JSON.stringify(req.params));
  debugPrint('body: ' + JSON.stringify(req.body));
  debugPrint('headers: ' + JSON.stringify(req.headers));

  // Check for necessary parameters
  if(!req.headers.peerid) {
    return sendErrorJSON(res, 'A "peerid" request header is necessary', 400);
  }
  req.headers.accountname = req.headers.accountname || 'root';

  const accountInfo = req.headers.peerid.split(':');
  const peerId = req.headers.peerid;
  const accountName = req.headers.accountname;
  const authtoken = req.headers.authtoken;
  if(!peerId || !authtoken) {
    return sendErrorJSON(res, 'A "peerid" and "authtoken" field are required for authentication', 400);
  }

  // Ensure they are attempting to access the correct IPFS identity (ie. they are aware of their own online identity)
  if(peerId !== distort_ipfs.peerId) {
    return sendErrorJSON(res, 'Attempting to login as IPFS identity: "' + peerId + '" server connected as: "' + distort_ipfs.peerId + '"', 403);
  }

  // Verify account exists and hash of account is correct
  Account.findOne({'accountName': accountName, 'peerId': peerId}, function(err, account) {
    if(err) {
      return sendErrorJSON(res, err, 500);
    }
    if(!account) {
      return sendErrorJSON(res, 'No such account: ' + formatPeerString(peerId, accountName), 404);
    }

    const _fromBits = sjcl.codec.base64.fromBits;
    const _hash = sjcl.hash.sha256.hash;
    const calcHash = _fromBits(_hash(authtoken));

    if(calcHash !== account.tokenHash) {
      return sendErrorJSON(res, 'Could not authenticate user as peer: ' + formatPeerString(peerId, accountName), 401);
    }

    account.lastInteraction = Date.now();
    account.save();
    next();
  });
};
