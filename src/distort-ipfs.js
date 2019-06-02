"use strict";

var ipfsAPI = require('ipfs-http-client'),
  sjcl = require('./sjcl'),
  config = require('./config'),
  groupTree = require('./groupTree'),
  mongoose = require('mongoose'),
  Account = mongoose.model('Accounts'),
  Cert = mongoose.model('Certs'),
  Conversation = mongoose.model('Conversations'),
  Group = mongoose.model('Groups'),
  Peer = mongoose.model('Peers'),
  InMessage = mongoose.model('InMessages'),
  OutMessage = mongoose.model('OutMessages');

// Some constants
const DEBUG = config.debug;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const PARANOIA = 8;
const MESSAGE_LENGTH = 1024;  // Should not be configurable, but a constant of the protocol
const PROTOCOL_VERSION = config.protocolVersion;
const SUPPORTED_PROTOCOLS = [PROTOCOL_VERSION];

const secp256k1 = sjcl.ecc.curves.k256;

// Create distort-on- ipfs object to export
const distort_ipfs = {_subscribedTo: {}};

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
function nameToCertTopic(name) {
  return name + '-certs';
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

distort_ipfs.initIpfs = function() {
  const self = this;
  const ipfsConfig = config.ipfsNode;

  return new Promise((resolve, reject) => {
    // Connect to IPFS node
    self.ipfsNode = ipfsAPI(ipfsConfig.address, ipfsConfig.port);
    self.ipfsNode.id((err, identity) => {
      if(err) {
        return reject('Failed to connect to IPFS node: ' + err);
      }
      if(DEBUG) {
        console.log("IPFS node has peer-ID: " + identity.id);
      }
      self.peerId = identity.id;

      // https://github.com/ipfs/go-ipfs/blob/c10f043f3bb7a48e8b43e7f4e35e1cbccf762c68/docs/experimental-features.md#message-signing
      self.ipfsNode.config.set('Pubsub.StrictSignatureVerification', true, (err) => {
        if(err) {
          reject('Could not ensure key verification: ' + err);
        }

        // Attempt to bootstrap specified peers
        if(typeof (ipfsConfig.bootstrap) === "object" && parseInt(ipfsConfig.bootstrap.length) > 0) {
          for(var i = 0; i < parseInt(ipfsConfig.bootstrap.length); i++) {
            const j = i;
            self.ipfsNode.swarm.connect(ipfsConfig.bootstrap, function (err) {
              if(DEBUG) {
                if(err) {
                  console.error("Bootstrap to peer failed: " + ipfsConfig.bootstrap[j]);
                } else {
                  console.log("Connected to peer " + ipfsConfig.bootstrap[j]);
                }
              }
            });
          }
        }

        // Find accounts for current IPFS ID (or create new 'root' account if none exist) that are enabled. 'root' cannot be disabled
        Account
          .find({peerId: self.peerId, enabled: true})
          .populate('cert')
          .exec(function(err, accounts) {

          if(err) {
            return reject('Could not search database: ' + err);
          }

          return new Promise((resolve2, reject2) => {
            if(accounts.length === 0) {
              // Create a new account
              let _hash = sjcl.hash.sha256.hash;
              let _pbkdf2 = sjcl.misc.pbkdf2;

              console.log('Creating new account for IPFS peer-ID: ' + self.peerId);

              // Password creation for new account
              var autoPassword = sjcl.codec.base64.fromBits(sjcl.random.randomWords(4));
              console.log('** PASSWORD. WRITE THIS DOWN FOR "root" SIGN-IN **: ' + autoPassword);
              const token = sjcl.codec.base64.fromBits(_pbkdf2(autoPassword, self.peerId, 1000));
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
                  return reject2('Could not save account: ' + err);
                }

                // Create and save new account schema
                var newAccount = new Account({
                  cert: cert._id,
                  peerId: self.peerId,
                  tokenHash: tokenHash
                });
                newAccount.save(function(err, acc) {
                  if(err) {
                    return reject2('Could not save account: ' + err);
                  }
                  if(DEBUG) {
                    console.log('Saved new account: ' + acc.peerId);
                  }
                  return resolve2(true);
                });
              });
            } else {
              // Account(s) for this IPFS node already exist
              for(var i = 0; i < accounts.length; i++) {
                const account = accounts[i];

                // Subscribe IPFS-node to all stored groups for account
                Group.find({owner: account._id}, function(err, groups) {
                  if(err) {
                    return reject2('Could not search database: ' + err);
                  }
                  for(var i = 0; i < groups.length; i++) {
                    self.subscribe(groups[i].name, groups[i].subgroupIndex);
                  }
                  return resolve2(true);
                });
              }
            }
          }).then(() => {
            // Setup routines to run
            self.msgIntervalId = setInterval(() => self._dequeueMsg(), 5 * SECONDS_PER_MINUTE * MS_PER_SECOND);
            self.certIntervalId = setInterval(() => self._publishCert(), 30 * SECONDS_PER_MINUTE * MS_PER_SECOND);

            // Always publish certificate on start
            self._publishCert();
            return resolve(true);
          }).catch(err => {
            throw reject(err);
          });
        });
      });
    });
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
    throw new Error("Invalid message length: " + msg.message.length + " for message: " + msg.message + "(Ensure MESSAGE_LENGTH is divisiblle by 8)");
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

  Account
  .find({peerId: self.peerId, enabled: true})
  .populate('cert')
  .populate('activeGroup')
  .exec(function(err, accounts) {
    if(err) {
      return console.error(err);
    }

    for(var i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      const group = account.activeGroup;
      if(!group) {
        continue;
      }

      OutMessage.aggregate([
      {
        $lookup: {
          from: 'certs',
          localField: 'to',
          foreignField: '_id',
          as:'to'
        }
      },
      {
        $lookup: {
          from: 'conversations',
          localField: 'conversation',
          foreignField: '_id',
          as:'conversation'
        }
      },
      {
        $unwind:'$to'
      },
      {
        $unwind:'$conversation'
      },
      {
        $match: {
          'status': 'enqueued',
          'conversation.group': group._id
        }
      }]).sort('lastStatusChange')
        .exec(function(err, msgs) {

        if(DEBUG) {
          console.log('Active group: ' + group.name);
          console.log('Queried messages: ' + JSON.stringify(msgs));
        }

        const randPath = groupTree.randomPath();
        if(DEBUG) {
          console.log(JSON.stringify(randPath));
        }

        var m = {v: PROTOCOL_VERSION, fromAccount: account.accountName};
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
        // NOTE: Marked as "wontfix" as of issue comment https://github.com/ryco117/distort-server/issues/1#issuecomment-461721028
        // Publish message to IPFS
        try {
          distort_ipfs.publishToSubgroups(group.name, randPath, JSON.stringify(m));
          if(index !== undefined) {
            OutMessage
              .findById(msgs[index]._id)
              .populate('conversation')
              .exec(function(err, msg) {

              if(err) {
                throw new Error(err);
              }
              msg.status = 'sent';
              msg.lastStatusChange = Date.now();
              msg.save();
              msg.conversation.latestStatusChangeDate = Date.now();
              msg.conversation.save();
            });
          }
        } catch(err) {
          return console.error(err);
        }
      });
    }
  });
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

        acct.cert.lastExpiration = Date.now() + 14*HOURS_PER_DAY*MINUTES_PER_HOUR*SECONDS_PER_MINUTE*MS_PER_SECOND;
        acct.cert.save(function(err) {
          if(err) {
            console.error('Could not save updated cert expiration: ' + err);
          }

          // If account has an active group, publish certificate over it
          if(acct.activeGroup) {
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
              distort_ipfs.publish(nameToCertTopic(acct.activeGroup.name), JSON.stringify(cert));
            } catch(err) {
              return console.error(err);
            }
          }
        });
      }
  });
}

// Receive message logic
function subscribeMessageHandler(msg) {
  if(DEBUG) {
    console.log('Received message: ' + msg.data);
    console.log('Message from IPFS node: ' + msg.from);
  }

  if(!distort_ipfs.peerId) {
    throw console.error('Cannot handle received messages without an active account');
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
    .find({peerId: distort_ipfs.peerId})
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
          throw console.error('Failed to decrypt');
        }

        cert = certs[i];
        break;
      } catch(e) {
        if(DEBUG) {
          console.log('Failed to decrypt: ' + e);
        }
      }
    }
    if(!cert) {
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
      throw console.error("Received message on improper group: " + fromGroup);
    }
    var groupName = groupPattern.exec(fromGroup)[1];
    var groupIndex = groupPattern.exec(fromGroup)[2];
    groupIndex = (groupIndex==="all") ? 0 : parseInt(groupIndex);

    // Determine which group message was received on
    Group.aggregate([
      {
        $lookup: {
          from: 'accounts',
          localField: 'owner',
          foreignField: '_id',
          as:'owner'
        }
      },
      {
        $unwind:'$owner'
      },
      {
        $match: {
          'name': groupName,
          'subgroupIndex': groupIndex,
          'owner.peerId': cert.peerId,
          'owner.accountName': cert.accountName
        }
      }]).exec(function(err, group) {

      group = group[0];
      if(!group) {
        throw console.error('Could not find a subscribed group: ' + JSON.stringify(fromGroup));
      }

      // Determine conversation of message, or create a new one
      new Promise(function(resolve, reject) {
        Conversation.findOne({group: group._id, peerId: from, accountName: msg.fromAccount || 'root'}, function(err, conversation) {
          if(err) {
            throw new Error(err);
          }
          if(conversation) {
            return resolve(conversation);
          } else {
            conversation = new Conversation({
              group: group._id,
              owner: group.owner._id,
              peerId: from,
              accountName: msg.fromAccount || 'root'
            });
            conversation.save(function(err, conversation) {
              if(err) {
                throw new Error(err);
              }
              resolve(conversation);
            });
          }
        });
      }).catch(function(err) {
        throw console.error(err);
      }).then(function(conversation) {
        // Save message to DB
        var inMessage = new InMessage({
          conversation: conversation._id,
          index: conversation.height++,
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

          conversation.latestStatusChangeDate = Date.now();
          conversation.save();
        });
      });
    });
  });
};

function certificateMessageHandler(cert) {
  if(DEBUG) {
    console.log('Received certificate: ' + cert.data);
    console.log('Certificate from: ' + cert.from);
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
      // Check if we have secret keys for cert (implying we own cert and thus it does not need updating)
      if(existingCert.key.encrypt.sec) {
        if(DEBUG) {
          console.log('This server owns certificate, no action needed');
        }
        return;
      }

      existingCert.lastExpiration = cert.expiration;
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
          // TODO: replace JSON.stringify with something more elegant once I know what the object structure looks like
          console.log("Invalidated " + JSON.stringify(updatedCount) + " certificates for: " + from + ":" + cert.fromAccount);
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

          // Update the certificate of any stored peers
          Peer.update({peerId: from, accountName: cert.fromAccount}, {$set: {cert: savedCert._id}}, function(err, updatedCount) {
            if(err) {
              throw console.error(err);
            }

            if(DEBUG) {
              console.log("Updated: " + updatedCount + " cert references for peer: " + from);
            }
          });
        });
      });
    }
  });
};

distort_ipfs.subscribe = function(name, subgroupIndex) {
  const self = this;
  subgroupIndex = parseInt(subgroupIndex);
  const topicCerts = nameToCertTopic(name);
  const topic = nameAndSubgroupToTopic(name, subgroupIndex);

  return new Promise((resolve, reject) => {
    // Remeber number of accounts requiring this channel
    if(self._subscribedTo[topic] > 0) {
      self._subscribedTo[topic]++;
      return resolve(true);
    } else {
      self.ipfsNode.pubsub.subscribe(topic, subscribeMessageHandler, {discover: true}, err => {
        if(err) {
          throw new Error('Failed to subscribe to: ' + topic + ' : ' + err);
        }
        if(DEBUG) {
          console.log('Now subscribed to: ' + topic);
        }

        self._subscribedTo[topic] = 1;
        return resolve(true);
      });
    }
  }).then(() => {
    // Remeber number of accounts requiring this channel
    if(self._subscribedTo[topicCerts] > 0) {
      return self._subscribedTo[topicCerts]++;
    } else {
      self.ipfsNode.pubsub.subscribe(topicCerts, certificateMessageHandler, {discover: true}, err => {
        if(err) {
          throw new Error('Failed to subscribe to: ' + topicCerts + ' : ' + err);
        }
        if(DEBUG) {
          console.log('Now subscribed to: ' + topicCerts);
        }

        self._subscribedTo[topicCerts] = 1;
        return;
      });
    }
  }).catch(err => {
    console.error(err);
  });
};

distort_ipfs.unsubscribe = function(name, subgroupIndex) {
  const self = this;
  subgroupIndex = parseInt(subgroupIndex);
  const topicCerts = nameToCertTopic(name);
  const topic = nameAndSubgroupToTopic(name, subgroupIndex);

  return new Promise((resolve, reject) => {
    // Only unsubscribe certs after no more accounts require it
    if(!self._subscribedTo[topic] || self._subscribedTo[topic] < 1) {
      return resolve(true);
    } else if(self._subscribedTo[topic] > 1) {
      self._subscribedTo[topic]--;
      return resolve(true);
    }

    // Only one account relies on channel, can unsubscribe
    self.ipfsNode.pubsub.unsubscribe(topic, subscribeMessageHandler, err => {
      if(err) {
        throw new Error('Failed to unsubscribe from: ' + topic, err);
      }
      if(DEBUG) {
        console.log('Unsubscribed from: ' + topic);
      }
      delete self._subscribedTo[topic];
      return resolve(true);
    });
  }).then(() => {
    if(!self._subscribedTo[topicCerts] || self._subscribedTo[topicCerts] < 1) {
      return;
    } else if(self._subscribedTo[topicCerts] > 1) {
      self._subscribedTo[topicCerts]--;
      return;
    }

    self.ipfsNode.pubsub.unsubscribe(topicCerts, certificateMessageHandler, err => {
      if(err) {
        throw new Error('Failed to unsubscribe from: ' + topicCerts, err);
      }
      if(DEBUG) {
        console.log('Unsubscribed from: ' + topicCerts);
      }

      delete self._subscribedTo[topicCerts];
      return;
    });
  }).catch(err => {
    console.error(err);
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
