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
const PROTOCOL_VERSION = "0.1.0";
const SUPPORTED_PROTOCOLS = [PROTOCOL_VERSION];

const secp256k1 = sjcl.ecc.curves.k256;

// Create distort-on- ipfs object to export
var distort_ipfs = {};

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
          return prompt('Password (empty for random string): ', {method: 'hide'}).then(function(password) {
            if(!password) {
              var autoPassword = sjcl.codec.base64.fromBits(sjcl.random.randomWords(6));
              console.log('Password (write this down for remote sign-in): ' + autoPassword);
              resolve(sjcl.codec.base64.fromBits(_pbkdf2(autoPassword, self.peerId, 1000)));
            } else {
              prompt('Repeat Password: ', {method: 'hide'}).then(function(passwordR) {
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
          const encSec = _fromBits(e.sec.get());
          var s = sjcl.ecc.ecdsa.generateKeys(secp256k1, PARANOIA);
          const sigSec = _fromBits(s.sec.get());

          // New certificate's schema
          var newCert = new Cert({
            key: {
              encrypt: {
                sec: encSec
              },
              sign: {
                sec: sigSec
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
            self.activeGroupId = account.activeGroupId;
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
                // Reconstruct group name and subindex from joined field in DB (with logic in case group name contains ':')
                const g = groups[i].split(':');
                const groupName = g.slice(0, g.length-1).join(":");
                const groupSubIndex = g[g.length - 1];
                self.subscribe(groupName, groupSubIndex);
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

// Simple helper to determine if non-empty intersection of arrays
function hasGroupInPath(path, groups) {
  for(var i = 0; i < path.length; i++) {
    if(groups.includes(path[i])) {
      return true;
    }
  }
  return false;
}

function packageMessage(msg) {
  // TODO: Implement encryption, padding, and signing function to package message
  var e = sjcl.ecc.elGamal.generateKeys(secp256k1, PARANOIA);

  // var sharedKey = e.secretKey.dh(msg.to.key.encrypt.pub);
  // msg.key = e.publicKey.get()

  delete msg.to;
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
      return res.send(err);
    }

    const randPath = groupTree.randomPathForGroup(group.name);
    if(DEBUG) {
      console.log(JSON.stringify(randPath));
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

      var m = {v: PROTOCOL_VERSION, account: group.accountName};
      for(var i = 0; i < msgs.length; i++) {
        if(hasGroupInPath(randPath, msgs[i].to.groups)) {
          m.message = msgs[i].message;
          m.to = msgs[i].to;
          break;
        }
      }
      if(!m) {
        m.message = sjcl.codec.base64.fromBits(sjcl.random.randomWords(192))    // 192 words -> 768 bytes -> 1024 printable chars
      }
      m = packageMessage(m);

      // Publish message to IPFS
      try {
        distort_ipfs.publish(group.name, JSON.stringify(m));
      } catch(err) {
        return res.send(err);
      }
    });
  });

  /* Safe removal of loop */
  // return clearInterval(self.msgIntervalId);
}

// Publish our certificate to the active group
distort_ipfs._publishCert = function() {
  const self = this;

  if(!self.activeGroupId) {
    return;
  }

  /* Safe removal of loop */
  // return clearInterval(self.certIntervalId);
}

function nameAndSubgroupToTopic(name, subgroupIndex) {
  if(subgroupIndex > 0) {
    name += '-' + subgroupIndex;
  } else {
    name += '-all';
  }

  return name;
}

// Receive message logic
function subscribeMessageHandler(msg) {
  if(DEBUG) {
    console.log('Received message: ' + msg.data);
    console.log('Message from: ' + msg.from);
  }

  // TODO: Modify so server can send message to itself for separate accounts
  if(msg.from == distort_ipfs.peerId) {
    return;
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

  // TODO: Decrypt message here to check belongs to us, and perform verification as necessary

  // Find group to save message to
  var groupPattern = /^(.*)-(all|\d+)$/;
  if(!groupPattern.test(fromGroup)) {
    throw new Error("Received message on improper group: " + fromGroup);
  }
  var groupName = groupPattern.exec(fromGroup)[1];
  var groupIndex = groupPattern.exec(fromGroup)[2];
  groupIndex = (groupIndex==="all") ? 0 : parseInt(groupIndex);

  // Save message to DB
  Group.findOne({peerId: distort_ipfs.peerId, accountName: 'root', name: groupName, subgroupIndex: groupIndex}, function(err, group) {
    if(!group) {
      throw new Error('Could not find a subscribed group in: ' + JSON.stringify(msg.topicIDs));
    }
    var inMessage = new InMessage({
      from: from,
      groupId: group._id,
      index: group.height++,
      message: msg.message,
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
};
function certificateMessageHandler(cert) {
  if(DEBUG) {
    console.log('Received message: ' + cert.data);
    console.log('Message from: ' + cert.from);
  }

  // TODO: Modify so server can send Certs to itself for separate accounts
  if(msg.from == distort_ipfs.peerId) {
    return;
  }

  var from = cert.from;
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

  if(cert.account && cert.account !== "root") {
    from += ":" + cert.account;
  }

  // Check if key already exists to be updated
  Cert.findOne({peerId: from, "key.encrypt.pub": cert.key.encrypt.pub, "key.sign.pub": cert.key.sign.pub, status: "valid"}, function(err, existingCert) {
    if(err) {
      throw console.error(err);
    }

    // If cert exists, update
    if(existingCert) {
      existingCert.lastExpiration = cert.lastExpiration;
      existingCert.groups = cert.groups;
      existingCert.save(function(err, cert) {
        if(err) {
          return console.error(err);
        }

        if(DEBUG) {
          console.log("Updated key for peer: " + from);
        };
      });
    } else {
      // Invalidate any other certs for this peer
      Cert.update({peerId: from, status: 'valid'}, {$set: {status: 'invalidated'}}, function(err, updatedCount) {
        if(err) {
          throw console.error(err);
        }
        if(DEBUG) {
          console.log("Invalidated: " + updatedCount + " certs for: " + from);
        }

        // Create new certificate from the message
        var newCert = new Cert({
          key: cert.key,
          lastExpiration: cert,
          peerId: from,
          groups: cert.groups
        });

        // Save certificate
        newCert.save(function(err, cert) {
          if(err) {
            return console.error(err);
          }

          if(DEBUG) {
            console.log("Imported new key for peer: " + from);
          }
        });
      });
    }
  });
};
distort_ipfs.subscribe = function(topic, subgroupIndex) {
  subgroupIndex = parseInt(subgroupIndex);
  const topicCerts = topic + '-certs';
  topic = nameAndSubgroupToTopic(topic, subgroupIndex);

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
      throw console.error('Failed to publish to: ' + topic, err);
    }
    if(DEBUG) {
      console.log('Published: ' + msg + ' to: ' + topic);
    }
  });
};

module.exports = distort_ipfs;
