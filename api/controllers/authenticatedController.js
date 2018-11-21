"use strict";

var sjcl = require('sjcl'),
  mongoose = require('mongoose'),
  Account = mongoose.model('Accounts');

const DEBUG = false;

// Retrieve messages for the specified group
exports.authenticate = function(req, res, next) {
  if(DEBUG) {
    console.log('params: ' + JSON.stringify(req.params));
    console.log('body: ' + JSON.stringify(req.body));
    console.log('headers: ' + JSON.stringify(req.headers));
  }
  
  if(!req.headers.peerid || !req.headers.authtoken) {
    return res.send('A "peerid" and "authtoken" field are required for authentication');
  }
  
  Account.findOne({'peerId': req.headers.peerid}, function(err, account) {
    if(err) {
      return res.send(err);
    }

    const _fromBits = sjcl.codec.base64.fromBits;
    const _hash = sjcl.hash.sha256.hash;
    const calcHash = _fromBits(_hash(req.headers.authtoken));
    if(calcHash !== account.tokenHash) {
      if(DEBUG) {
        console.log('Tried to authenticate as: ' + req.headers.peerid + ' with token-hash: ' + calcHash + ' , expecting: ' + account.tokenHash);
      }
      return res.send('Could not authenticate user as peer: ' + req.headers.peerid);
    }
    
    account.lastInteraction = Date.now();
    account.save();
    next();
  });
};