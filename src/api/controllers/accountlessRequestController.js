"use strict";

var sjcl = require('../../sjcl'),
  distort_ipfs = require('../../distort-ipfs'),
  config = require('../../config'),
  utils = require('../../utils'),
  mongoose = require('mongoose'),
  Account = mongoose.model('Accounts'),
  Cert = mongoose.model('Certs');

const debugPrint = utils.debugPrint;
const sendErrorJSON = utils.sendErrorJSON;
const secp256k1 = utils.secp256k1;
const PARANOIA = utils.PARANOIA;


exports.getIpfs = function(req, res) {
  debugPrint('Unauthenticated Request: /ipfs')
  debugPrint('params: ' + JSON.stringify(req.params));
  debugPrint('body: ' + JSON.stringify(req.body));
  debugPrint('headers: ' + JSON.stringify(req.headers));

  utils.sendMessageJSON(res, distort_ipfs.peerId);
};

exports.createAccount = function(req, res) {
  debugPrint('Unauthenticated Request: /create-account')
  debugPrint('params: ' + JSON.stringify(req.params));
  debugPrint('body: ' + JSON.stringify(req.body));
  debugPrint('headers: ' + JSON.stringify(req.headers));

  const peerId = req.body.peerId;
  const authToken = req.body.authToken;
  const accountName = req.body.accountName;
  const signature = req.body.signature;

  if(!signature || !peerId || !accountName || !authToken) {
    return sendErrorJSON(res, 'Missing required fields', 400);
  }

  Account.findOne({'accountName': accountName, 'peerId': peerId}, function(err, acc) {
    if(!!acc) {
      return sendErrorJSON(res, 'Account ' + utils.formatPeerString(peerId, accountName) + ' exists', 400);
    }

    // Fetch root account if exists and check if contains signed text
    Cert.findOne({'accountName': 'root', 'peerId': peerId}, function(err, rootCert) {
      if(err) {
        return sendErrorJSON(res, err, 500);
      }
      if(!rootCert) {
        return sendErrorJSON(res, 'No "root" account for IPFS ID: ' + peerId, 404);
      }

      const publicKeyStrs = rootCert.key.sign.pub.split(':');
      const x = new sjcl.bn(publicKeyStrs[0]);
      const y = new sjcl.bn(publicKeyStrs[1]);
      const publicKey = new sjcl.ecc.ecdsa.publicKey(secp256k1, new sjcl.ecc.point(secp256k1, x, y));

      try {
        if(!publicKey.verify(sjcl.hash.sha256.hash(accountName), sjcl.codec.hex.toBits(signature))) {
          throw false;
        }
      } catch (e) {
        return sendErrorJSON(res, 'Failed to verify signature', 401);
      }

      const tokenHash = sjcl.codec.base64.fromBits(sjcl.hash.sha256.hash(authToken));
      let _fromBits = sjcl.codec.hex.fromBits;

      // Create new private/public keypairs for account
      var e = sjcl.ecc.elGamal.generateKeys(secp256k1, PARANOIA);

      // Get encryption strings
      const encSec = _fromBits(e.sec.get());
      const encPubCouple = e.pub.get();
      const encPub = _fromBits(encPubCouple.x) + ":" + _fromBits(encPubCouple.y);

      // Get signing strings
      var s = sjcl.ecc.ecdsa.generateKeys(secp256k1, PARANOIA);
      const sigSec = _fromBits(s.sec.get());
      const sigPubCouple = s.pub.get();
      const sigPub = _fromBits(sigPubCouple.x) + ":" + _fromBits(sigPubCouple.y)

      // New certificate's schema
      var newCert = new Cert({
        key: {
          encrypt: {
            sec: encSec,
            pub: encPub
          },
          sign: {
            sec: sigSec,
            pub: sigPub
          }
        },
        lastExpiration: Date.now() + utils.CERT_LENGTH,
        peerId: peerId,
        accountName: accountName
      });

      // Save for reference
      newCert.save(function(err, cert) {
        if(err) {
          return sendErrorJSON(res, 'Could not save account: ' + err, 500);
        }

        // Create and save new account schema
        var newAccount = new Account({
          cert: cert._id,
          peerId: peerId,
          accountName: accountName,
          tokenHash: tokenHash
        });
        newAccount.save(function(err, acc) {
          if(err) {
            return sendErrorJSON(res, 'Could not save account: ' + err, 500);
          }

          debugPrint('Saved new account: ' + utils.formatPeerString(peerId, accountName));
          acc.cert = undefined;
          return res.json(acc);
        });
      });
    });
  });
};
