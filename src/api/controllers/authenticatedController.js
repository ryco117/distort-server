"use strict";

var sjcl = require('sjcl'),
  distort_ipfs = require('../../distort-ipfs'),
  config = require('../../config'),
  mongoose = require('mongoose'),
  Account = mongoose.model('Accounts');

const DEBUG = config.debug;

// Retrieve messages for the specified group
exports.authenticate = function(req, res, next) {
  if(DEBUG) {
    console.log('params: ' + JSON.stringify(req.params));
    console.log('body: ' + JSON.stringify(req.body));
    console.log('headers: ' + JSON.stringify(req.headers));
  }

  // Check for necessary parameters
  if(!req.headers.peerid) {
    res.status(400);
    return res.send('A "peerid" request header is necessary');
  }
  req.headers.accountname = req.headers.accountname || 'root';

  const accountInfo = req.headers.peerid.split(':');
  const peerId = req.headers.peerid;
  const accountName = req.headers.accountname;
  const authtoken = req.headers.authtoken;
  if(!peerId || !authtoken) {
    res.status(400);
    return res.send('A "peerid" and "authtoken" field are required for authentication');
  }

  // Ensure they are attempting to access the correct IPFS identity (ie. they are aware of their own online identity)
  if(peerId !== distort_ipfs.peerId) {
    res.status(403);
    return res.send(new Error('Attempting to login as IPFS identity: "' + peerId + '" server connected as: "' + distort_ipfs.peerId + '"'));
  }

  // Verify account exists and hash of account is correct
  Account.findOne({'accountName': accountName, 'peerId': peerId}, function(err, account) {
    if(err) {
      return res.send(err);
    }

    const _fromBits = sjcl.codec.base64.fromBits;
    const _hash = sjcl.hash.sha256.hash;
    const calcHash = _fromBits(_hash(authtoken));
    if(calcHash !== account.tokenHash) {
      if(DEBUG) {
        console.log('Tried to authenticate as: ' + peerId + ' with token-hash: ' + calcHash + ' , expecting: ' + account.tokenHash);
      }
      res.status(401);
      return res.send('Could not authenticate user as peer: ' + peerId + ":" + accountName);
    }

    account.lastInteraction = Date.now();
    account.save();
    next();
  });
};
