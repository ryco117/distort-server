"use strict";

var distort_ipfs = require('../../distort-ipfs'),
  config = require('../../config');

const DEBUG = config.debug;

// List all (sub)group memberships through their groups and subgroup paths
exports.getIpfs = function(req, res) {
  if(DEBUG) {
    console.log('Unauthenticated Request: ipfs/')
    console.log('params: ' + JSON.stringify(req.params));
    console.log('body: ' + JSON.stringify(req.body));
    console.log('headers: ' + JSON.stringify(req.headers));
  }

  res.send(distort_ipfs.peerId);
};
