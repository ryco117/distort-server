"use strict";

var ipfsAPI = require('ipfs-http-client'),
  mongoose = require('mongoose'),
  twit = require('twit'),
  sjcl = require('./sjcl'),
  config = require('./config'),
  utils = require('./utils'),
  groupTree = require('./groupTree'),
  Account = mongoose.model('Accounts'),
  Cert = mongoose.model('Certs'),
  Conversation = mongoose.model('Conversations'),
  Group = mongoose.model('Groups'),
  Peer = mongoose.model('Peers'),
  InMessage = mongoose.model('InMessages'),
  OutMessage = mongoose.model('OutMessages'),
  SocialMediaLink = mongoose.model('SocialMediaLinks');

// Some constants
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const MESSAGE_LENGTH = 1024;  // Should not be configurable, but a constant of the protocol
const PROTOCOL_VERSION = config.protocolVersion;
const SUPPORTED_PROTOCOLS = [PROTOCOL_VERSION];
const secp256k1 = utils.secp256k1;
const PARANOIA = utils.PARANOIA;
const debugPrint = utils.debugPrint;
const debugPrintError = utils.debugPrintError;
const formatPeerString = utils.formatPeerString;


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

// Helper function to connect to at most 2 configured bootstrap peers.
// This is significantly more important in the early phases as
// DistoRt peers will be few and far between
function bootstrapPeers(ipfsNode) {
  const ipfsConfig = config.ipfsNode;
  const len = parseInt(ipfsConfig.bootstrap.length);
  const promises = [];
  const usedIndexes = {};

  for(var i = 0; i < Math.min(2, len); i++) {
    var k;
    do {
      k = Math.floor(Math.random() * len);
    } while(usedIndexes[k]);

    usedIndexes[k] = true;
    promises.push(ipfsNode.swarm.connect(ipfsConfig.bootstrap[k]));
  }

  return Promise.all(promises);
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
      debugPrint("IPFS node has peer-ID: " + identity.id);
      self.peerId = identity.id;

      // https://github.com/ipfs/go-ipfs/blob/c10f043f3bb7a48e8b43e7f4e35e1cbccf762c68/docs/experimental-features.md#message-signing
      self.ipfsNode.config.set('Pubsub.StrictSignatureVerification', true, (err) => {
        if(err) {
          return reject('Could not ensure key verification: ' + err);
        }

        // Attempt to use experimental routing gossipsub, but do not fail on error
        // https://github.com/ipfs/go-ipfs/blob/bc7c0c0f88f0f7eef497056c2edcf23d542550c6/docs/experimental-features.md#gossipsub
        self.ipfsNode.config.set('Pubsub.Router', 'gossipsub', err => {
          if(err) {
            debugPrintError('Could not ensure "gossipsub" protocol: ' + err);
          }
        });

        // Attempt to bootstrap specified peers
        var bootstrapPromise = Promise.resolve(true);
        if(typeof (ipfsConfig.bootstrap) === "object" && parseInt(ipfsConfig.bootstrap.length) > 0) {
          bootstrapPromise = bootstrapPeers(self.ipfsNode).catch(err => {
            debugPrintError('Failed to complete bootstrap list: ' + err);
          });
        }

        // If bootstrapping, wait until finished before continuing
        bootstrapPromise.then(() => {
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

                debugPrint('Creating new account for IPFS peer-ID: ' + self.peerId);

                // Password creation for new account
                const autoPassword = sjcl.codec.base64.fromBits(sjcl.random.randomWords(4));
                console.log('** PASSWORD. WRITE THIS DOWN FOR "root" SIGN-IN **: ' + autoPassword);
                const token = sjcl.codec.base64.fromBits(_pbkdf2(autoPassword, self.peerId, 1000));
                console.log('REST Authentication Token: ' + token);
                const tokenHash = sjcl.codec.base64.fromBits(_hash(token));
                debugPrint('Token-hash: ' + tokenHash);

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
                  peerId: self.peerId
                });

                // Save for reference
                return newCert.save().then(function(cert) {
                  // Create and save new account schema
                  var newAccount = new Account({
                    cert: cert._id,
                    peerId: self.peerId,
                    tokenHash: tokenHash
                  });
                  return newAccount.save();
                }).then(function(acc) {
                  debugPrint('Saved new account: ' + acc.peerId);
                  return resolve2(true);
                }).catch(err => {
                  return reject2('Could not save to database: ' + err);
                });
              } else {
                var andTheyStillFeelOhSoWastedOnMyself = [];

                // Account(s) for this IPFS node already exist
                for(var i = 0; i < accounts.length; i++) {
                  const account = accounts[i];

                  // Subscribe IPFS-node to all stored groups for account
                  andTheyStillFeelOhSoWastedOnMyself.push(Group.find({owner: account._id}));
                }
                return Promise.all(andTheyStillFeelOhSoWastedOnMyself).then(function(groupsArrays) {
                    for(var i = 0; i < groupsArrays.length; i++) {
                      for(var j = 0; j < groupsArrays[i].length; j++) {
                        self.subscribe(groupsArrays[i][j].name, groupsArrays[i][j].subgroupIndex);
                      }
                    }
                    return resolve2(true);
                }).catch(err => {
                    return reject2('Could not search database: ' + err);
                });
              }
            }).then(() => {
              // Setup routines to run
              self.msgIntervalId = setInterval(() => self._dequeueMsg(), 5 * SECONDS_PER_MINUTE * MS_PER_SECOND);
              self.certIntervalId = setInterval(() => self._publishCert(), 30 * SECONDS_PER_MINUTE * MS_PER_SECOND);

              // Always publish certificate on start
              self._publishCert();

              if(config.socialMedia) {
                // Read and save validated social media identities
                if(config.socialMedia.stream) {
                  self.streamTwitter();
                }

                // Daily post to social media profiles linking to distort identities
                if(config.socialMedia.link) {
                  self.linkIntervalId = setInterval(() => self._linkAccounts(), HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND);
                  self._linkAccounts();
                }
              }

              return resolve(true);
            }).catch(err => {
              throw reject(err);
            });
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
    // Pad message to size by generating random blocks of 8 hexadecimal chars
    var paddingSize = parseInt((MESSAGE_LENGTH - msg.message.length - 15)/8);
    var padding = sjcl.codec.hex.fromBits(sjcl.random.randomWords(paddingSize));

    // Fill the remainder 0 <= r < 8 padding characters with 'a'
    while(padding.length + msg.message.length + 15 < MESSAGE_LENGTH) {
      padding += 'a';
    }

    // Create message
    msg.message = JSON.stringify({'m':msg.message,'p':padding});      // 15 extra characters are added when stringified

    // Prepare shared AES key
    var pointStrings = msg.to.key.encrypt.pub.split(':');
    var pubPoint = new sjcl.ecc.point(secp256k1, new sjcl.bn(pointStrings[0]), new sjcl.bn(pointStrings[1]));
    var pubKey = new sjcl.ecc.elGamal.publicKey(secp256k1, pubPoint);
    sharedAes = new sjcl.cipher.aes(e.sec.dh(pubKey));
  } else {
    // Generate bogus message using 4096 bits to produce 1024 hex-characters
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

  debugPrint("Packaged Message: " + JSON.stringify(msg));
  return msg;
}

// Dequeue next available unsent message (where availability is determined randomly)
distort_ipfs._dequeueMsg = function () {
  const self = this;

  // NOTE: IPFS doesn't seem to have an ability to prioritize keeping
  // specified nodes, meaning that the manually bootstrapped nodes may be
  // dropped without warning. This logic is to ensure the configured
  // nodes are always maintained when broadcasting messages.
  // TODO: Remove this logic when anonymity group is large enough that
  // peers will maintain a connected graph without this
  var bootstrapPromise = Promise.resolve(true);
  if(typeof (config.ipfsNode.bootstrap) === "object" && parseInt(config.ipfsNode.bootstrap.length) > 0) {
    bootstrapPromise = bootstrapPeers(self.ipfsNode).catch(err => {
      debugPrintError('Failed to complete bootstrap list: ' + err);
    });
  }
  bootstrapPromise.then(() => {
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

          debugPrint('Active group: ' + group.name);
          debugPrint('Queried messages: ' + JSON.stringify(msgs));

          const randPath = groupTree.randomPath();
          debugPrint(JSON.stringify(randPath));

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

          // Sign ciphertext using accounts signing key
          // Allows for the possibility of publically available IPFS nodes used for pubsub,
          // with accounts still on private machines
          m.signature = utils.signText(account.cert.key.sign.sec, m.cipher);

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
      if(err) {
        return console.error('Failed to search database for enabled accounts: ' + err);
      }

      for(var i = 0; i < accounts.length; i++) {
        const acct = accounts[i];

        acct.cert.lastExpiration = Date.now() + 14*HOURS_PER_DAY*MINUTES_PER_HOUR*SECONDS_PER_MINUTE*MS_PER_SECOND;
        acct.cert.save(function(err) {
          if(err) {
            console.error('Could not save updated cert expiration: ' + err);
          }

          // Strip our social media keys from certificate (as well as pointless object ID)
          const medias = [];
          for(let socialMedia of acct.cert.socialMedia) {
            medias.push({platform: socialMedia.platform, handle: socialMedia.handle});
          }

          // If account has an active group, publish certificate over it
          if(acct.activeGroup) {
            // Create cert for active account
            const cert = {
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
              groups: acct.cert.groups,
              signature: utils.signText(acct.cert.key.sign.sec, formatPeerString(self.peerId, acct.accountName))
            };
            if(medias.length > 0) {
              cert.socialMedia = medias;
            }

            debugPrint("Packaged Certificate: " + JSON.stringify(cert));

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

// Optionally link social media accounts to IPFS identity
distort_ipfs._linkAccounts = function() {
  const self = this;

  Account
    .find({peerId: self.peerId, enabled: true})
    .populate('cert')
    .exec(function(err, accounts) {
    if(err) {
      return console.error('Failed to search database for enabled accounts: ' + err);
    }

    // For every enabled account, post to their social media identities
    for(var i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      const fullAddress = formatPeerString(account.peerId, account.accountName);

      for(let platform of account.cert.socialMedia) {
        switch(platform.platform) {
          case 'twitter':
            var twitterKey;
            try {
              twitterKey = JSON.parse(platform.key);
            } catch(err) {
              console.error('Failed to parse twitter key: ' + platform.key + ': ' + err);
              continue;
            }

            var T = new twit({
              consumer_key: twitterKey.consumer_key,
              consumer_secret: twitterKey.consumer_secret,
              access_token: twitterKey.access_token,
              access_token_secret: twitterKey.access_token_secret,
              timeout_ms: 5000, // opt
              strictSSL: true   // opt
            });

            // Get Twitter handle signature using certificate's signing key
            const signature = utils.signText(account.cert.key.sign.sec, 'twitter://' + platform.handle);
            const intros = ['Hi! My distort identity is ', 'Hello there, you can find me on distort at ', '', 'My ID is '];
            const intro = intros[Math.floor(intros.length * Math.random())];
            T.post('statuses/update', {status: '#distort_id ' + intro + fullAddress + ' , Signature ' + signature}, function(err, data, response) {
              if(err) {
                console.error('Error occured while linking to Twitter for account: ' + fullAddress + ': ' + err);
              } else {
                debugPrint('Successfully posted link to Twitter user @' + platform.handle + '\'s feed');
              }
            });
            break;
          default:
            break;
        }
      }
    }
  });
}


// Optionally, stream Twitter #distort_id for distort identities to link
distort_ipfs.streamTwitter = function() {
  const self = this;

  // Don't recreate stream if exists
  if(self._twitter_stream) {
    return Promise.resolve();
  }

  return Account
    .find({peerId: self.peerId, enabled: true})
    .populate('cert')
    .exec().then(accounts => {
    var twitterKey;

    // Choose a random account to start search at.
    // This is for fair assigning of feed-streaming among those with Twitter accounts
    const start = Math.floor(accounts.length * Math.random());
    for(var i = 0; i < accounts.length; i++) {
      const k = (start+i) % accounts.length;
      for(var j = 0; j < accounts[k].cert.socialMedia.length; j++) {
        if(accounts[k].cert.socialMedia[j].platform === 'twitter') {
          try {
            twitterKey = JSON.parse(accounts[k].cert.socialMedia[j].key);
            break;
          } catch(err) {
            console.error('ERROR: Can\'t read account\'s Twitter key: ' + err);
            twitterKey = undefined;
          }
        }
      }
      if(twitterKey) {
        break;
      }
    }

    if(!twitterKey) {
      debugPrint('Failed to initiate Twitter stream: no accounts have Twitter authentication');
      return;
    }

    const T = new twit({
      consumer_key: twitterKey.consumer_key,
      consumer_secret: twitterKey.consumer_secret,
      access_token: twitterKey.access_token,
      access_token_secret: twitterKey.access_token_secret,
      timeout_ms: 5000, // opt
      strictSSL: true   // opt
    });

    const linkExp = new RegExp("^#distort_id(\\s[a-zA-Z_.,!\\s-]*)?\\s([1-9A-HJ-NP-Za-km-z]+)(:[^\\s]+)?\\s,\\sSignature\\s([a-zA-Z0-9+/=]+)$", "g");
    self._twitter_stream = T.stream('statuses/filter', {track: '#distort_id'});
    self._twitter_stream.on('tweet', function(tweet) {
      // Received a tweet on #distort_id
      const handle = tweet.user.screen_name;
      const tweetContent = tweet.extended_tweet.full_text;

      debugPrint('Tweet from: ' + handle);
      debugPrint(tweetContent);

      // Check for correct syntax
      const linkMatch = linkExp.exec(tweetContent);
      if(linkMatch) {
        const peerId = linkMatch[2];
        const accountName = linkMatch[3] ? linkMatch[3].substring(1) : 'root';
        const signature = linkMatch[4];

        return Cert.findOne({peerId: peerId, accountName: accountName}).then(cert => {
          if(!cert) {
            throw 'no certificate found for peer';
          }

          if(!utils.verifySignature(cert.key.sign.pub, 'twitter://' + handle, signature)) {
            throw 'signature failed validation';
          }

          // Valid signature. Update existing link or save new one
          return SocialMediaLink.findOne({platform: 'twitter', handle: handle}).then(link => {
            if(link) {
              link.cert = cert._id;
            } else {
              link = new SocialMediaLink({platform: 'twitter', handle: handle, cert: cert._id});
            }
            return link.save();
          }).then(link => {
            debugPrint('twitter:'+handle + ' <-> ' + formatPeerString(peerId, accountName));
          });
        }).catch(err => {
          debugPrint('Could not link identities: ' + err);
        });
      } else {
        debugPrint('Could not link identities: invalid tweet format');
      }
    }); // End received-a-tweet
  }).catch(err => {
    console.error('ERROR: Failed to initiate Twitter stream: ' + err);
  });
};


// Receive message logic
function messageHandler(msg) {
  debugPrint('Received message: ' + msg.data);
  debugPrint('Message from IPFS node: ' + msg.from);

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
    debugPrintError("Could not decode: " + err);
    return;
  }

  // Find latest cert from peer which has not expired and use it to verify signature
  Cert
    .findOne({peerId: from, accountName: msg.fromAccount, status: 'valid'})
    .where('lastExpiration').gt(Date.now())
    .exec(function(err, peerCert) {
    if(err) {
      throw new Error(err);
    }

    // Verify signatures on messages. This allows for the possibility of
    // publically available IPFS nodes used for pushing pubsub messages
    const verifiedSig = peerCert && msg.cipher && msg.signature &&
      utils.verifySignature(peerCert.key.sign.pub, msg.cipher, msg.signature);

    // Find all our certs that match the current IPFS node that have not expired
    // and attempt to decrypt with them
    Cert
      .find({peerId: distort_ipfs.peerId})
      .where('lastExpiration').gt(Date.now())
      .exec(function(err, certs) {
      if(err) {
        throw new Error(err);
      }

      // Get public key for elGamal
      var tmpKey = msg.encrypt.split(':');
      tmpKey = new sjcl.ecc.point(secp256k1, new sjcl.bn(tmpKey[0]), new sjcl.bn(tmpKey[1]));
      tmpKey = new sjcl.ecc.elGamal.publicKey(secp256k1, tmpKey);

      // Determine if any accounts can decrypt message
      var cert = null;
      var plaintext;
      for(var i = 0; i < certs.length; i++) {
        // Get shared key using ephemeral ECC and secret key from account-certificate
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
          debugPrint('Failed to decrypt: ' + e);
        }
      }
      if(!cert) {
        return;
      }

      // Received message!
      console.log('Received message: ' + plaintext);

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
            verified: verifiedSig
          });
          inMessage.save(function(err, msg) {
            if(err) {
              throw console.error(err);
            }
            debugPrint('Saved received message to DB at index: ' + msg.index);

            conversation.latestStatusChangeDate = Date.now();
            conversation.save();
          });
        });
      });
    });
  });
};

function certificateHandler(cert) {
  debugPrint('Received certificate: ' + cert.data);
  debugPrint('Certificate from: ' + cert.from);

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
    return debugPrintError("Could not decode: " + err);
  }

  // Verify signing key belongs to claimed account
  if(!utils.verifySignature(cert.key.sign.pub, formatPeerString(from, cert.fromAccount), cert.signature)) {
    return debugPrintError("Failed to verify signature on certificate");
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
        debugPrint('This server owns certificate, no action needed');
        return;
      }

      existingCert.lastExpiration = cert.expiration;
      existingCert.groups = cert.groups;
      existingCert.socialMedia = cert.socialMedia;
      existingCert.save(function(err, savedCert) {
        if(err) {
          return console.error(err);
        }

        debugPrint("Updated key for peer: " + formatPeerString(from, cert.fromAccount));
      });
    } else {
      // Invalidate any other certs for this peer
      Cert.updateMany({peerId: from, accountName: cert.fromAccount, status: 'valid'}, {status: 'invalidated'}, function(err, updatedCount) {
        if(err) {
          throw console.error(err);
        }
        if(updatedCount.nModified > 0) {
          debugPrint("Invalidated " + updatedCount.nModified + " certificates for: " + formatPeerString(from, cert.fromAccount));
        }

        // Create new certificate from the message
        var newCert = new Cert({
          accountName: cert.fromAccount,
          key: cert.key,
          lastExpiration: cert.expiration,
          peerId: from,
          groups: cert.groups,
          socialMedia: cert.socialMedia
        });

        // Save certificate
        newCert.save(function(err, savedCert) {
          if(err) {
            return console.error(err);
          }

          debugPrint("Imported new key for peer: " + formatPeerString(from, cert.fromAccount));

          // Update the certificate of any stored peers
          Peer.updateMany({peerId: from, accountName: cert.fromAccount}, {cert: savedCert._id}, function(err, updatedCount) {
            if(err) {
              throw console.error(err);
            }

            debugPrint("Updated: " + updatedCount.nModified + " cert references for peer: " + from);
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
      self.ipfsNode.pubsub.subscribe(topic, messageHandler, {discover: true}, err => {
        if(err) {
          throw new Error('Failed to subscribe to: ' + topic + ' : ' + err);
        }
        debugPrint('Now subscribed to: ' + topic);

        self._subscribedTo[topic] = 1;
        return resolve(true);
      });
    }
  }).then(() => {
    // Remeber number of accounts requiring this channel
    if(self._subscribedTo[topicCerts] > 0) {
      return self._subscribedTo[topicCerts]++;
    } else {
      self.ipfsNode.pubsub.subscribe(topicCerts, certificateHandler, {discover: true}, err => {
        if(err) {
          throw new Error('Failed to subscribe to: ' + topicCerts + ' : ' + err);
        }
        debugPrint('Now subscribed to: ' + topicCerts);

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
    self.ipfsNode.pubsub.unsubscribe(topic, messageHandler, err => {
      if(err) {
        throw new Error('Failed to unsubscribe from: ' + topic, err);
      }
      debugPrint('Unsubscribed from: ' + topic);
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

    self.ipfsNode.pubsub.unsubscribe(topicCerts, certificateHandler, err => {
      if(err) {
        throw new Error('Failed to unsubscribe from: ' + topicCerts, err);
      }
      debugPrint('Unsubscribed from: ' + topicCerts);

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
    debugPrint('Published to: ' + topic);
  });
};

distort_ipfs.publishToSubgroups = function(groupName, subgroups, msg) {
  for(var i = 0; i < subgroups.length; i++) {
    this.publish(nameAndSubgroupToTopic(groupName, subgroups[i]), msg);
  }
};

module.exports = distort_ipfs;
