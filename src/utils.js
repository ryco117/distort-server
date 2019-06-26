"use strict";

const config = require('./config'),
  sjcl = require('./sjcl');

const DEBUG = config.debug;
const secp256k1 = sjcl.ecc.curves.k256;
const PARANOIA = 8;

exports.CERT_LENGTH =  14*24*3600*1000;   // 2 weeks
exports.PARANOIA = PARANOIA;

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
exports.secp256k1 = secp256k1;

// Sign text with key as string and return as Base64
exports.signText = function(secretString, plaintext) {
  const sec = new sjcl.ecc.ecdsa.secretKey(secp256k1, new sjcl.bn(secretString));
  return sjcl.codec.base64.fromBits(sec.sign(sjcl.hash.sha256.hash(plaintext), PARANOIA));
};

// Verify signature with public key as string
exports.verifySignature = function(publicString, plaintext, signature) {
  const publicKeyStrs = publicString.split(':');
  const x = new sjcl.bn(publicKeyStrs[0]);
  const y = new sjcl.bn(publicKeyStrs[1]);
  const publicKey = new sjcl.ecc.ecdsa.publicKey(secp256k1, new sjcl.ecc.point(secp256k1, x, y));

  try {
    if(!publicKey.verify(sjcl.hash.sha256.hash(plaintext), sjcl.codec.base64.toBits(signature))) {
      return false;
    }
    return true
  } catch (e) {
    return false;
  }
}
