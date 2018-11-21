var ipfsAPI = require('ipfs-api'),
  sjcl = require('sjcl'),
  prompt = require('password-prompt'),
  groupTree = require('./groupTree'),
  mongoose = require('mongoose'),
  Account = mongoose.model('Accounts'),
  Cert = mongoose.model('Certs'),
  Group = mongoose.model('Groups'),
  InMessage = mongoose.model('InMessages'),
  OutMessage = mongoose.model('OutMessages');

// Some constants
const DEBUG = true;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const PARANOIA = 8;
const PROTOCOL_VERSION = "0.1.0";
const SUPPORTED_PROTOCOLS = [PROTOCOL_VERSION];

const secp256k1 = new sjcl.ecc.curves.k256;

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

    // Find/Setup admin account for IPFS ID
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
                   return reject(new Error('Password do not match, account creation aborted'));
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
            
            // Save cert keys to distort object
            self.key = {encrypt: e, sign: s};
            
            // Create and save new account schema
            var newAccount = new Account({
              peerId: self.peerId,
              tokenHash: tokenHash,
              cert: cert._id
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
        // Current group to actively provide cover-traffic to
        self.activeGroupId = accounts[0].activeGroupId;
        
        // Load keypairs for current certificate
        Cert.findById(accounts[0].cert, function(err, cert) {
          if(err) {
            throw console.error(err);
          }
          if(!cert) {
            throw new Error('A certificate is required for key-pair usage for accounts');
          }
          
          // Reload key-pairs from DB
          const eExp = new sjcl.bn(cert.key.encrypt.sec);
          var e = sjcl.ecc.elGamal.generateKeys(secp256k1, PARANOIA, eExp);
          const sExp = new sjcl.bn(cert.key.sign.sec);
          var s = sjcl.ecc.elGamal.generateKeys(secp256k1, PARANOIA, sExp);
          self.key = {encrypt: e, sign: s};
          
          
          // Key is loaded into memory, subscribe to groups
          // Subscribe IPFS-node to all stored groups for active account
          Group.find({accountId: self.peerId}, function(err, groups) {
            if(err) {
              throw console.error(err);
            }
            for(var  i = 0; i < groups.length; i++) {
              const g = groups[i];
              self.subscribe(g.name, g.subgroupIndex);
            }
          });
        });
      }
    });
    
    // Setup routine to run
    function _dequeueMsg() {
      if(!self.activeGroupId) {
        return;
      }
      
      const randPath = groupTree.randomPath();
      if(DEBUG) {
      console.log(JSON.stringify(randPath));
      }
      
      Group.findById(self.activeGroupId, function(err, group) {
        if(err) {
          return res.send(err);
        }
        
        OutMessage
          .find({groupId: self.activeGroupId, status: 'enqueued'})
          .sort('lastStatusChange')
          .exec(function(err, msgs) {
         
          if(DEBUG) {
            console.log('Active group: ' + group.name);
            console.log('Queried messages: ' + JSON.stringify(msgs));
          }
          
          var m = {v: PROTOCOL_VERSION};
          for(var i = 0; i < msgs.length; i++) {
            m.message = msgs[i].message;
            break;
          } 
          if(!m) {
            m.message = "xyzxuz";
          }
          
          // m = packageMessage(m);
          
          // Publish message to IPFS
          try { 
            distort_ipfs.publish(group.name, JSON.stringify(m));
          } catch(err) {
            return res.send(err);
          }
        });
      });
      
      /* Safe removal of loop */
      // return clearInterval(ntervalId);
    }
    function _verifyCert() {
      if(!self.activeGroupId) {
        return;
      }
      
      
    }
    
    self.msgIntervalId = setInterval(() => _dequeueMsg(), 5 * SECONDS_PER_MINUTE * MS_PER_SECOND);
    self.certIntervalId = setInterval(() => _verifyCert(), 60 * SECONDS_PER_MINUTE * MS_PER_SECOND);
  });
};

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
  Group.findOne({accountId: distort_ipfs.peerId, name: groupName, subgroupIndex: groupIndex}, function(err, group) {
    if(!group) {
      throw new Error('Could not find a subscribed group in: ' + JSON.stringify(msg.topicIDs));
    }
    var inMessage = new InMessage({
      cipher: msg.cipher,
      from: from,
      groupId: group._id,
      index: group.height++,
      message: "**TODO**",
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
  if(msg.from == distort_ipfs.peerId) {
    return;
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
  Cert.findOne({peerId: from, "key.encrypt.pub": cert.key.encrypt.pub, "key.sign.pub": cert.key.sign.pub}, function(err, existingCert) {
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
      // Create new certificate from the message
      var newCert = new Cert({
        key: cert.key,
        lastExpiration: cert,
        peerId: from,
        groups: cert.groups
      });
      
      // Save for reference
      newCert.save(function(err, cert) {
        if(err) {
          return console.error(err);
        }
        
        if(DEBUG) {
          console.log("Imported new key for peer: " + from);
        }
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