var ipfsAPI = require('ipfs-api'),
  sjcl = require('sjcl'),
  prompt = require('password-prompt'),
  config = require('./config'),
  groupTree = require('./groupTree'),
  mongoose = require('mongoose'),
  Account = mongoose.model('Accounts'),
  Cert = mongoose.model('Certs'),
  Group = mongoose.model('Groups'),
  InMessage = mongoose.model('InMessages'),
  OutMessage = mongoose.model('OutMessages');

// Some constants
const DEBUG = config.debug;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const PARANOIA = 8;
const MESSAGE_LENGTH = config.messageLength;
const PROTOCOL_VERSION = config.protocolVersion;
const SUPPORTED_PROTOCOLS = [PROTOCOL_VERSION];

const secp256k1 = sjcl.ecc.curves.k256;

// Create distort-on- ipfs object to export
var distort_ipfs = {};

// Group naming helpers
function toGroupIndexCouple(group, index) {
  return group + ":" + index;
}
function fromGroupIndexCouple(groupIndex) {
  // Reconstruct group name and subindex from joined field in DB (with logic in case group name contains ':')
  const g = groupIndex.split(':');
  const groupName = g.slice(0, g.length-1).join(":");
  const groupSubIndex = g[g.length - 1];

  return {name: groupName, index: groupSubIndex}
}
function nameAndSubgroupToTopic(name, subgroupIndex) {
  if(subgroupIndex > 0) {
    name += '-' + subgroupIndex;
  } else {
    name += '-all';
  }

  return name;
}
// Simple helper to determine if non-empty intersection of arrays
function hasGroupInPath(groupName, path, groups) {
  for(var i = 0; i < path.length; i++) {
    if(groups.includes(toGroupIndexCouple(groupName, path[i]))) {
      return true;
    }
  }
  return false;
}

distort_ipfs.initIpfs = function(address, port) {
  var self = this;

  // Conenct to IPFS node
  this.ipfsNode = ipfsAPI(address, port);
  this.ipfsNode.id((err, identity) => {
    if(err) {
      throw console.error('Failed to connect to IPFS node: ' + err);
    }
    if(DEBUG) {
      console.log("IPFS node is initialized with peer-ID: " + identity.id);
    }
    self.peerId = identity.id;

    // Find accounts for current IPFS ID (or create new 'root' account if none exist)
    Account.find({peerId: self.peerId}, function(err, accounts) {
      if(err) {
        throw console.error(err);
      }

      if(accounts.length === 0) {
        // Create a new account
        let _hash = sjcl.hash.sha256.hash;
        let _pbkdf2 = sjcl.misc.pbkdf2;

        console.log('Creating new account for IPFS peer-ID: ' + self.peerId);

        // Password creation for new account
        new Promise(function(resolve, reject) {
          return prompt('Password (empty for random string): ', {method: "mask"}).then(function(password) {
            if(!password) {
              var autoPassword = sjcl.codec.base64.fromBits(sjcl.random.randomWords(6));
              console.log('Password (write this down for remote sign-in): ' + autoPassword);
              resolve(sjcl.codec.base64.fromBits(_pbkdf2(autoPassword, self.peerId, 1000)));
            } else {
              prompt('Repeat Password: ', {method: "mask"}).then(function(passwordR) {
                if(password !== passwordR) {
                   return reject(new Error('Passwords do not match, account creation aborted'));
                }
                resolve(sjcl.codec.base64.fromBits(_pbkdf2(password, self.peerId, 1000)));
              });
            }
          });
        }).then(function(token) {
          var tokenHash = sjcl.codec.base64.fromBits(_hash(token));
          if(DEBUG) {
            console.log('Token: ' + token);
            console.log('Token-hash: ' + tokenHash);
          }
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
            lastExpiration: Date.now() + 14*HOURS_PER_DAY*MINUTES_PER_HOUR*SECONDS_PER_MINUTE*MS_PER_SECOND,
            peerId: self.peerId
          });

          // Save for reference
          newCert.save(function(err, cert) {
            if(err) {
              throw console.error(err);
            }

            // Create and save new account schema
            var newAccount = new Account({
              accountName: 'root',
              cert: cert._id,
              peerId: self.peerId,
              tokenHash: tokenHash
            });
            newAccount.save(function(err, acc) {
              if(err) {
                throw console.error(err);
              }
              if(DEBUG) {
                console.log('Saved new account: ' + acc.peerId);
              }
            });
          });
        });
      } else {
        for(var i = 0; i < accounts.length; i++) {
          const account = accounts[i];

          // TODO: REMOVE TEST VALUE self.activeGroupId
          if(account.accountName === 'root') {
            self.activeGroupId = account.activeGroup;
          }

          // Load keypairs for current certificate
          Cert.findById(account.cert, function(err, cert) {
            if(err) {
              throw console.error(err);
            }
            if(!cert) {
              throw new Error('A certificate is required for accounts');
            }

            // Subscribe IPFS-node to all stored groups for account
            Group.find({peerId: account.peerId, accountName: account.accountName}, function(err, groups) {
              if(err) {
                throw console.error(err);
              }
              for(var  i = 0; i < groups.length; i++) {
                self.subscribe(groups[i].name, groups[i].subgroupIndex);
              }
            });
          });
        }
      }
    });

    // Setup routines to run
    self.msgIntervalId = setInterval(() => self._dequeueMsg(), 5 * SECONDS_PER_MINUTE * MS_PER_SECOND);
    self.certIntervalId = setInterval(() => self._publishCert(), 60 * SECONDS_PER_MINUTE * MS_PER_SECOND);
  });
};

function packageMessage(msg) {
  // Implement encryption, padding, and signing function to package message
  var e = sjcl.ecc.elGamal.generateKeys(secp256k1, PARANOIA);
  var tmpKeyPoint = e.pub.get();
  msg.encrypt = sjcl.codec.hex.fromBits(tmpKeyPoint.x) + ":" + sjcl.codec.hex.fromBits(tmpKeyPoint.y);

  var sharedAes;
  // If sending real message
  if(msg.to) {
    // Pad message to size
    var paddingSize = parseInt((MESSAGE_LENGTH - msg.message.length - 15)/8);
    var padding = sjcl.codec.hex.fromBits(sjcl.random.randomWords(paddingSize));
    while(padding.length + msg.message.length + 15 < MESSAGE_LENGTH) {
      padding += "a";
    }

    // Create message
    msg.message = JSON.stringify({'m':msg.message,'p':padding});      // 15 extra characters are added when stringified

    // Prepare shared AES key
    var pointStrings = msg.to.key.encrypt.pub.split(':');
    var pubPoint = new sjcl.ecc.point(secp256k1, new sjcl.bn(pointStrings[0]), new sjcl.bn(pointStrings[1]));
    var pubKey = new sjcl.ecc.elGamal.publicKey(secp256k1, pubPoint);
    sharedAes = new sjcl.cipher.aes(e.sec.dh(pubKey));
  } else {
    // Generate bogus message
    msg.message = sjcl.codec.hex.fromBits(sjcl.random.randomWords(parseInt(MESSAGE_LENGTH/8)));

    // Since there is no real recipient, can use any key
    var ephemeral = sjcl.ecc.elGamal.generateKeys(secp256k1, PARANOIA);
    sharedAes = new sjcl.cipher.aes(e.sec.dh(ephemeral.pub));
  }

  if(msg.message.length !== MESSAGE_LENGTH) {
    throw new Error("Invalid message length: " + msg.message.length + " for message: " + msg.message + "(Ensure messageLength in configuration is divisiblle by 8)");
  }

  // Encrypt text with key and convert to Base64
  var iv = sjcl.random.randomWords(4);
  msg.iv = sjcl.codec.base64.fromBits(iv);
  msg.cipher = sjcl.codec.base64.fromBits(sjcl.mode.ccm.encrypt(sharedAes, sjcl.codec.utf8String.toBits(msg.message), iv));

  // Delete private fields
  delete msg.to;
  delete msg.message;

  if(DEBUG) {
    console.log("Packaged Message: " + JSON.stringify(msg));
  }
  return msg;
}

// Dequeue next available unsent message (where availability is determined randomly)
distort_ipfs._dequeueMsg = function () {
  const self = this;

  if(!self.activeGroupId) {
    return;
  }

  // TODO: dequeue for all accounts with IPFS-ID matching current node

  // Find active group for account
  Group.findById(self.activeGroupId, function(err, group) {
    if(err) {
      return console.error(err);
    }

    OutMessage
      .find({groupId: self.activeGroupId, status: 'enqueued'})
      .populate('to')
      .sort('lastStatusChange')
      .exec(function(err, msgs) {

      if(DEBUG) {
        console.log('Active group: ' + group.name);
        console.log('Queried messages: ' + JSON.stringify(msgs));
      }

      const randPath = groupTree.randomPath();
      if(DEBUG) {
        console.log(JSON.stringify(randPath));
      }

      var m = {v: PROTOCOL_VERSION, fromAccount: group.accountName};
      var index = undefined;
      for(var i = 0; i < msgs.length; i++) {
        if(hasGroupInPath(group.name, randPath, msgs[i].to.groups)) {
          m.message = msgs[i].message;
          m.to = msgs[i].to;
          index = i;
          break;
        }
      }
      m = packageMessage(m);

      // TODO: Sign ciphertext using accounts signing key

      // Publish message to IPFS
      try {
        distort_ipfs.publishToSubgroups(group.name, randPath, JSON.stringify(m));
        if(index !== undefined) {

          msgs[index].status = 'sent';
          msgs[index].save();
        }
      } catch(err) {
        return console.error(err);
      }
    });
  });

  /* Safe removal of loop */
  // return clearInterval(self.msgIntervalId);
}

// Publish our certificate to the active group
distort_ipfs._publishCert = function() {
  const self = this;

  // Find all enabled accounts matching IPFS node
  Account
    .find({peerId: self.peerId, enabled: true})
    .populate('activeGroup')
    .populate('cert')
    .exec(function(err, accounts) {
      for(var i = 0; i < accounts.length; i++) {
        const acct = accounts[i];

        // Create cert for active account
        var cert = {
          v: PROTOCOL_VERSION,
          fromAccount: acct.accountName,
          key: {
            encrypt: {
              pub: acct.cert.key.encrypt.pub
            },
            sign: {
              pub: acct.cert.key.sign.pub
            }
          },
          expiration: acct.cert.lastExpiration,
          groups: acct.cert.groups
        };

        if(DEBUG) {
          console.log("Packaged Certificate: " + JSON.stringify(cert));
        }

        // Publish message to IPFS
        try {
          distort_ipfs.publish(acct.activeGroup.name + "-cert", JSON.stringify(cert));
        } catch(err) {
          return console.error(err);
        }
      }
  });

  /* Safe removal of loop */
  // return clearInterval(self.certIntervalId);
}

// Receive message logic
function subscribeMessageHandler(msg) {
  if(DEBUG) {
    console.log('Received message: ' + msg.data);
    console.log('Message from: ' + msg.from);
  }

  if(!distort_ipfs.peerId) {
    throw new Error('Cannot handle received messages without an active account');
  }

  const from = msg.from;
  const fromGroup = msg.topicIDs[0];
  try {
    msg = JSON.parse(msg.data);
    if(!msg.v) {
      throw new Error('No version given');
    }
    if(!SUPPORTED_PROTOCOLS.includes(msg.v)) {
      throw new Error('No support for given version: ' + msg.v);
    }
  } catch(err) {
    if(DEBUG) {
      console.error("Could not decode: " + err);
    }
    return;
  }

  // Find all certs that match the current IPFS node that have not expired
  Cert
    .find({peerId: distort_ipfs.peerId, })
    .where('lastExpiration').gt(Date.now())
    .exec(function(err, certs) {

    // Get public key for elGamal
    var tmpKey = msg.encrypt.split(':');
    tmpKey = new sjcl.ecc.point(secp256k1, new sjcl.bn(tmpKey[0]), new sjcl.bn(tmpKey[1]));
    tmpKey = new sjcl.ecc.elGamal.publicKey(secp256k1, tmpKey);

    // Determine if any accounts can decrypt message
    var cert = null;
    var plaintext;
    for(var i = 0; i < certs.length; i++) {
      // Get shared key using ephereal ECC and secret key from account-certificate
      var e = new sjcl.bn(certs[i].key.encrypt.sec);
      e = sjcl.ecc.elGamal.generateKeys(secp256k1, PARANOIA, e);
      var sharedAes = new sjcl.cipher.aes(e.sec.dh(tmpKey));

      // Decrypt message here to check belongs to us
      try {
        const iv = sjcl.codec.base64.toBits(msg.iv);
        plaintext = sjcl.codec.utf8String.fromBits(sjcl.mode.ccm.decrypt(sharedAes, sjcl.codec.base64.toBits(msg.cipher), iv));
        plaintext = JSON.parse(plaintext);
        plaintext = plaintext.m;
        if(typeof plaintext !== "string") {
          throw new Error('Failed to decrypt');
        }

        cert = certs[i];
        break;
      } catch(e) {
        if(DEBUG) {
          console.log('Failed to decrypt: ' + e);
        }
      }
    }
    if(cert === null) {
      return;
    }

    // Received message!
    if(DEBUG) {
      console.log('Received message: ' + plaintext);
    }

    // TODO: perform verification as necessary

    // Find group to save message to
    var groupPattern = /^(.*)-(all|\d+)$/;
    if(!groupPattern.test(fromGroup)) {
      throw new Error("Received message on improper group: " + fromGroup);
    }
    var groupName = groupPattern.exec(fromGroup)[1];
    var groupIndex = groupPattern.exec(fromGroup)[2];
    groupIndex = (groupIndex==="all") ? 0 : parseInt(groupIndex);

    // Save message to DB
    Group.findOne({peerId: distort_ipfs.peerId, accountName: cert.accountName, name: groupName, subgroupIndex: groupIndex}, function(err, group) {
      if(!group) {
        throw new Error('Could not find a subscribed group in: ' + JSON.stringify(msg.topicIDs));
      }
      var inMessage = new InMessage({
        from: {
          accountName: msg.fromAccount || 'root',
          peerId: from
        },
        groupId: group._id,
        index: group.height++,
        message: plaintext,
        verified: false
      });
      inMessage.save(function(err, msg) {
        if(err) {
          throw console.error(err);
        }
        if(DEBUG) {
          console.log('Saved received message to DB at index: ' + msg.index);
        }

        group.save();
      });
    });
  });
};
function certificateMessageHandler(cert) {
  if(DEBUG) {
    console.log('Received message: ' + cert.data);
    console.log('Message from: ' + cert.from);
  }

  const from = cert.from;
  try {
    cert = JSON.parse(cert.data);
    if(!cert.v) {
      throw new Error('No version given');
    }
    if(!SUPPORTED_PROTOCOLS.includes(cert.v)) {
      throw new Error('No support for given version: ' + cert.v);
    }
  } catch(err) {
    if(DEBUG) {
      console.error("Could not decode: " + err);
    }
    return;
  }

  // Check if key already exists to be updated
  Cert.findOne({peerId: from, accountName: cert.fromAccount, "key.encrypt.pub": cert.key.encrypt.pub, "key.sign.pub": cert.key.sign.pub, status: "valid"}, function(err, existingCert) {
    if(err) {
      throw console.error(err);
    }

    // If cert exists, update
    if(existingCert) {
      existingCert.lastExpiration = cert.lastExpiration;
      existingCert.groups = cert.groups;
      existingCert.save(function(err, savedCert) {
        if(err) {
          return console.error(err);
        }

        if(DEBUG) {
          console.log("Updated key for peer: " + from + ":" + cert.fromAccount);
        };
      });
    } else {
      // Invalidate any other certs for this peer
      Cert.update({peerId: from, accountName: cert.fromAccount, status: 'valid'}, {$set: {status: 'invalidated'}}, function(err, updatedCount) {
        if(err) {
          throw console.error(err);
        }
        if(DEBUG) {
          console.log("Invalidated: " + updatedCount + " certs for: " + from);
        }

        // Create new certificate from the message
        var newCert = new Cert({
          accountName: cert.fromAccount,
          key: cert.key,
          lastExpiration: cert.expiration,
          peerId: from,
          groups: cert.groups
        });

        // Save certificate
        newCert.save(function(err, savedCert) {
          if(err) {
            return console.error(err);
          }

          if(DEBUG) {
            console.log("Imported new key for peer: " + from + ":" + cert.fromAccount);
          }
        });
      });
    }
  });
};
distort_ipfs.subscribe = function(name, subgroupIndex) {
  subgroupIndex = parseInt(subgroupIndex);
  const topicCerts = name + '-certs';
  topic = nameAndSubgroupToTopic(name, subgroupIndex);

  this.ipfsNode.pubsub.subscribe(topic, subscribeMessageHandler, {discover: true}, err => {
    if(err) {
      throw console.error('Failed to subscribe to: ' + topic, err);
    }
    this.ipfsNode.pubsub.subscribe(topicCerts, certificateMessageHandler, {discover: true}, err => {
      if(err) {
        throw console.error('Failed to subscribe to: ' + topicCerts, err);
      }
      if(DEBUG) {
        console.log('Now subscribed to: ' + topic);
      }
    });
  });
};
distort_ipfs.unsubscribe = function(topic, subgroupIndex) {
  subgroupIndex = parseInt(subgroupIndex);
  const topicCerts = topic + '-certs';
  topic = nameAndSubgroupToTopic(topic, subgroupIndex);

  this.ipfsNode.pubsub.unsubscribe(topic, subscribeMessageHandler, err => {
    if(err) {
      throw console.error('Failed to unsubscribe from: ' + topic, err);
    }
    this.ipfsNode.pubsub.unsubscribe(topicCerts, certificateMessageHandler, err => {
      if(err) {
        throw console.error('Failed to unsubscribe from: ' + topicCerts, err);
      }
      if(DEBUG) {
        console.log('Unsubscribed from: ' + topic);
      }
    });
  });
};

distort_ipfs.publish = function(topic, msg) {
  this.ipfsNode.pubsub.publish(topic, Buffer.from(msg), err => {
    if(err) {
      throw new Error('Failed to publish to: ' + topic, err);
    }
    if(DEBUG) {
      console.log('Published to: ' + topic);
    }
  });
};

distort_ipfs.publishToSubgroups = function(groupName, subgroups, msg) {
  for(var i = 0; i < subgroups.length; i++) {
    this.publish(nameAndSubgroupToTopic(groupName, subgroups[i]), msg);
  }
};

module.exports = distort_ipfs;
