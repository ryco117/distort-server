"use strict";

var distort_ipfs = require('../../distort-ipfs');

// List all (sub)group memberships through their groups and subgroup paths
exports.getIpfs = function(req, res) {
  res.send(distort_ipfs.peerId);
};
