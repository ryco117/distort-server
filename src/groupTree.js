"use strict";

var sjcl = require('./sjcl');

const MAX_PATH_DEPTH = 5;
exports.MAX_PATH_DEPTH = MAX_PATH_DEPTH;
const MAX_INDEX = Math.pow(2, MAX_PATH_DEPTH + 1) - 2;
exports.MAX_INDEX = MAX_INDEX;

exports.randomPath = function() {
  var r = sjcl.random.randomWords(1)[0];
  var path = [0];
  const sign = 1;
  for(var i = 0; i < MAX_PATH_DEPTH; i++) {
    var p = path[i];
    path[i+1] = (r & sign) > 0 ? (2*p + 1) : (2*p + 2);
    r = r >>> 1;
  }
  return path;
};

exports.randomFromLevel = function(level) {
  var path = this.randomPath();
  return path[Math.abs(parseInt(level))];
};
