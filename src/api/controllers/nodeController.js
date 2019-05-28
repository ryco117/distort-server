"use strict";

var distort_ipfs = require('../../distort-ipfs'),
  config = require('../../config'),
  utils = require('../../utils');

const DEBUG = config.debug;

exports.getIpfs = function(req, res) {
  if(DEBUG) {
    console.log('Unauthenticated Request: ipfs/')
    console.log('params: ' + JSON.stringify(req.params));
    console.log('body: ' + JSON.stringify(req.body));
    console.log('headers: ' + JSON.stringify(req.headers));
  }

  utils.sendMessageJSON(res, distort_ipfs.peerId);
};
