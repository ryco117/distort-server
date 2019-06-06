"use strict";

var distort_ipfs = require('../../distort-ipfs'),
  config = require('../../config'),
  utils = require('../../utils');

const debugPrint = utils.debugPrint;

exports.getIpfs = function(req, res) {
  debugPrint('Unauthenticated Request: ipfs/')
  debugPrint('params: ' + JSON.stringify(req.params));
  debugPrint('body: ' + JSON.stringify(req.body));
  debugPrint('headers: ' + JSON.stringify(req.headers));

  utils.sendMessageJSON(res, distort_ipfs.peerId);
};
