"use strict";

var mongoose = require('mongoose'),
  sjcl = require('sjcl'),
  distort_ipfs = require('../../distort-ipfs'),
  groupTree = require('../../groupTree'),
  config = require('../../config'),
  Account = mongoose.model('Accounts'),
  Cert = mongoose.model('Certs'),
  Conversation = mongoose.model('Conversations'),
  Group = mongoose.model('Groups'),
  InMessage = mongoose.model('InMessages'),
  OutMessage = mongoose.model('OutMessages'),
  Peer = mongoose.model('Peers');

const DEBUG = config.debug;

// Ensure the correct active Group-ID in DB
function updateActiveGroup(peerId, groupId, accountName) {
  Account.findOne({'peerId': peerId, 'accountName': accountName || 'root'}, function(err, account) {
    if(err) {
      throw err;
    }

    if(account.activeGroup != groupId) {
      account.activeGroup = groupId;
      account.save();
    }
  });
}

// Send error JSON
function sendErrorJSON(res, err, statusCode) {
  res.status(statusCode);

  err = (typeof err === "string") ? err : JSON.stringify(err);

  if(DEBUG) {
    console.error(err + " : " + statusCode);
  }

  return res.json({error: err});
}

// List all (sub)group memberships through their groups and subgroup paths
exports.listGroups = function(req, res) {
  Group.aggregate(
  [{
    $lookup: {
      from: 'accounts',
      localField: 'owner',
      foreignField: '_id',
      as: 'owner'
    }
  },
  {
    $unwind: '$owner'
  },
  {
    $match: {
      'owner.peerId': req.headers.peerid,
      'owner.accountName': req.headers.accountname
    }
  }]).exec(function(err, groups) {
    if(err) {
      return sendErrorJSON(res, err, 500);
    }

    // Pointless to reinform of self as owner
    for(var i = 0; i < groups.length; i++) {
      delete groups[i].owner;
    }

    res.json(groups);
  });
};

// Add topic and given subgroup path to account's groups
exports.addGroup = function(req, res) {
  const subLevel = parseInt(req.body.subgroupLevel);
  if(isNaN(subLevel) || subLevel < 0 || subLevel > groupTree.MAX_PATH_DEPTH) {
    return sendErrorJSON(res, '"subgroupLevel" must be a non-negative integer', 400);
  }
  const subI = groupTree.randomFromLevel(subLevel);

  Account.findOne({peerId: req.headers.peerid, accountName: req.headers.accountname}, function(err, account) {
    if(err) {
      return sendErrorJSON(res, err, 500);
    }

    var reqGroup = {};
    reqGroup.name = req.body.name;
    reqGroup.owner = account._id;
    Group.findOne(reqGroup, function(err, group) {
      if(err) {
        return sendErrorJSON(res, err, 500);
      }

      if(group) {
        try {
          distort_ipfs.subscribe(reqGroup.name, subI);
        } catch(err) {
          return sendErrorJSON(res, err, 500);
        }
        group.subgroupIndex = subI;
        group.save();
        return res.json(group);
      }

      reqGroup.subgroupIndex = subI;
      try {
        distort_ipfs.subscribe(reqGroup.name, subI);
      } catch(err) {
        return sendErrorJSON(res, err, 500);
      }

      var newGroup = new Group(reqGroup);
      newGroup.save(function(err, group) {
        if(err) {
          return sendErrorJSON(res, err, 500);
        }

        // If none active, set new group to be active group
        try {
          updateActiveGroup(req.headers.peerid, group._id, req.headers.accountname);
        } catch(err) {
          return sendErrorJSON(res, err, 500);
        }

        // Include group in certificate
        Cert.findById(account.cert, function(err, cert) {
          if(err) {
            return sendErrorJSON(res, err, 500);
          }
          cert.groups.push(group.name + ":" + group.subgroupIndex);
          cert.save(function(err) {
            if(err) {
              return sendErrorJSON(res, err, 500);
            }

            // Succeeded all the trials, group is fully added
            res.json(group);
          });
        });
      });
    });
  });
};

// List all (sub)group memberships through their groups and subgroup paths
exports.fetchConversations = function(req, res) {
  Conversation.aggregate([
  {
    $lookup: {
      from: 'accounts',
      localField: 'owner',
      foreignField: '_id',
      as: 'owner'
    }
  },
  {
    $lookup: {
      from: 'groups',
      localField: 'group',
      foreignField: '_id',
      as: 'group'
    }
  },
  {
    $unwind: '$owner'
  },
  {
    $unwind: '$group'
  },
  {
    $match: {
      'owner.peerId': req.headers.peerid,
      'owner.accountName': req.headers.accountname,
      'group.name': req.params.groupName
    }
  }]).exec(function(err, groups) {
    if(err) {
      return sendErrorJSON(res, err, 500);
    }

    for(var i = 0; i < groups.length; i++) {
      delete groups[i].owner;
      delete groups[i].group;
    }

    res.json(groups);
  });
};

// Enqueue a message to the specified group
exports.postMessage = function(req, res) {
  Group.aggregate(
  [{
    $lookup: {
      from: 'accounts',
      localField: 'owner',
      foreignField: '_id',
      as: 'owner'
    }
  },
  {
    $unwind: '$owner'
  },
  {
    $match: {
      'name': req.params.groupName,
      'owner.peerId': req.headers.peerid,
      'owner.accountName': req.headers.accountname
    }
  }]).exec(function(err, group) {
    if(err) {
      return sendErrorJSON(res, err, 500);
    }

    group = group[0];
    if(!group) {
      return sendErrorJSON(res, 'Account is not a member of group: ' + req.params.groupName, 400);
    }

    // Must include a 'to' object
    if(!req.body.toPeerId && !req.body.toNickname) {
      return sendErrorJSON(res, 'Must include "toPeerId" or "toNickname" in request body', 400);
    }

    // Must include a non-empty message
    if(!req.body.message || typeof req.body.message !== "string") {
      return sendErrorJSON(res, 'Must include a non-empty string "message" in request body', 400);
    }

    // Determine if we have the certificate of the intended peer
    var certPromise = new Promise(function(resolve, reject) {
      // Can specify peer by friendly nickname or explicit peer-ID
      if(req.body.toPeerId) {
        Cert.findOne({accountName: req.body.toAccountName || 'root', peerId: req.body.toPeerId, status: 'valid'}, function(err, cert) {
          if(!cert) {
            reject('Could not find cert for given peer-ID. Plesase wait for their periodically posted certificate');
          } else {
            resolve(cert);
          }
        });
      } else {
        Account.findOne({peerId: req.headers.peerid, accountName: req.headers.accountname}, function(err, account) {
          if(err) {
            return sendErrorJSON(res, err, 500);
          }

          Peer
            .findOne({owner: account._id, nickname: req.body.toNickname})
            .populate('cert')
            .exec(function(peer) {

            if(!peer) {
              reject('Could not find cert for given nickname. Plesase wait for their periodically posted certificate');
            } else {
              resolve(peer.cert);
            }
          });
        });
      }
    }).catch(function(err) {
      return sendErrorJSON(res, err, 400);
    }).then(function(toCert) {
      // If posting to this account and group soon, assume it to be the active group
      try {
        updateActiveGroup(req.headers.peerid, group._id, req.headers.accountname);
      } catch(err) {
        return sendErrorJSON(res, err, 500);
      }

      // Must get conversation this message belongs to, or create a new one
      new Promise(function (resolve, reject) {
        Conversation.findOne({group: group._id, peerId: toCert.peerId, accountName: toCert.accountName}, function(err, conversation) {
          if(err) {
            return reject(err);
          }
          if(conversation) {
            return resolve(conversation);
          } else {
            Account.findOne({peerId: req.headers.peerid, accountName: req.headers.accountname}, function(err, account) {
              if(err) {
                return reject(err);
              }
              const newConversation = new Conversation({
                group: group._id,
                owner: account._id,
                peerId: toCert.peerId,
                accountName: toCert.accountName
              });
              newConversation.save(function(err, conversation) {
                if(err) {
                  return reject(err);
                }
                return resolve(conversation);
              });
            });
          }
        });
      }).catch(function(err) {
        return sendErrorJSON(res, err, 500);
      }).then(function(conversation) {
        var outMessage = new OutMessage({
          conversation: conversation._id,
          index: conversation.height++,
          message: req.body.message,
          to: toCert._id
        });
        outMessage.save(function(err, msg) {
          if(err) {
            return sendErrorJSON(res, err, 500);
          }

          if(DEBUG) {
            console.log('Saved enqueued message to DB at index: ' + msg.index);
          }

          conversation.latestStatusChangeDate = Date.now();
          conversation.save(function(err) {
            if(err) {
              return sendErrorJSON(res, err, 500);
            }

            // Only send success after all transactions succeed
            res.json(msg);
          });
        });
      }).catch(function(err) {
        return sendErrorJSON(res, err, 500);
      });
    });
  });
};

// Stop streaming on the specified group
exports.leaveGroup = function(req, res) {
  Group.aggregate(
  [{
      $lookup: {
      from: 'accounts',
      localField: 'owner',
      foreignField: '_id',
      as: 'owner'
    }
  },
  {
    $unwind: '$owner'
  },
  {
    $match: {
      'name': req.params.groupName,
      'owner.peerId': req.headers.peerid,
      'owner.accountName': req.headers.accountname
    }
  }]).exec(function(err, group) {
    if(err) {
      return sendErrorJSON(res, err, 500);
    }

    group = group[0];
    if(!group) {
      return sendErrorJSON(res, 'Account is not a member of group: ' + req.params.groupName, 400);
    }

    Group.findByIdAndRemove(group._id, function(err, delStats) {
      if(err) {
        return sendErrorJSON(res, err, 500);
      }

      try {
        distort_ipfs.unsubscribe(group.name, group.subgroupIndex);
      } catch(err) {
        console.log(err);
      }

      // Remove group from certificate
      Account
        .findOne({peerId: req.headers.peerid, accountName: req.headers.accountname})
        .select('activeGroup, cert')
        .exec(function(err, acct) {
        if(err) {
          return sendErrorJSON(res, err, 500);
        }

        if(acct.activeGroup === group._id) {
          delete acct.activeGroup;
          acct.save();
        }

        Cert.findById(acct.cert, function(err, cert) {
          if(err) {
            return sendErrorJSON(res, err, 500);
          }

          const couple = group.name + ":" + group.subgroupIndex;
          for(var i = 0; i < cert.groups.length; i++) {
            if(couple === cert.groups[i]) {
              cert.groups.splice(i, 1);
              break;
            }
          }
          cert.save(function(err) {
            if(err) {
              return sendErrorJSON(res, err, 500);
            }

            res.json({message: 'Successfully left group: ' + req.params.groupName});
          });
        });
      })
    });
  });
};

// Retrieve messages for the specified group
exports.readConversationMessagesInRange = function(req, res) {
  Group.aggregate(
  [{
      $lookup: {
      from: 'accounts',
      localField: 'owner',
      foreignField: '_id',
      as: 'owner'
    }
  },
  {
    $unwind: '$owner'
  },
  {
    $match: {
      'name': req.params.groupName,
      'owner.peerId': req.headers.peerid,
      'owner.accountName': req.headers.accountname
    }
  }]).exec(function(err, group) {
    if(err) {
      return sendErrorJSON(res, err, 500);
    }

    group = group[0];
    if(!group) {
      return sendErrorJSON(res, 'Account is not a member of group: ' + req.params.groupName, 400);
    }

    Conversation.findOne({group: group._id, peerId: req.headers.conversationpeerid, accountName: req.headers.conversationaccountname || 'root'}, function(err, conversation) {
      if(err) {
        return sendErrorJSON(res, err, 500);
      }
      if(!conversation) {
        // Group exists but there have been no messages between peers
        return res.json({'in': [], 'out': []});
      }

      const indexStart = parseInt(req.params.indexStart);
      const indexEnd = req.params.indexEnd ? parseInt(req.params.indexEnd) : conversation.height-1;

      InMessage
        .find({'conversation': conversation._id})
        .where('index').gte(indexStart).lte(indexEnd)
        .sort('index')
        .select('dateReceived index message verified')
        .exec(function(err, inMsgs) {
        if(err) {
          return sendErrorJSON(res, err, 500);
        }

        OutMessage
          .find({'conversation': conversation._id})
          .where('index').gte(indexStart).lte(indexEnd)
          .sort('index')
          .select('index lastStatusChange message status')
          .exec(function(err, outMsgs) {
          if(err) {
            return sendErrorJSON(res, err, 500);
          }

          res.json({'conversation': conversation._id, 'in': inMsgs, 'out': outMsgs});
        });
      });
    });
  });
};


// Retrieve account information
exports.fetchAccount = function(req, res) {
  Account
    .findOne({peerId: req.headers.peerid, accountName: req.headers.accountname})
    .populate({path: 'activeGroup', select: 'name subgroupIndex'})
    .select('accountName activeGroup enabled peerId')
    .exec(function(err, acct) {
    if(err) {
      return sendErrorJSON(res, err, 500);
    }

    res.json(acct);
  });
};


// Create new account (if 'root')
exports.updateAccount = function(req, res) {
  req.body.accountName = req.body.accountName || 'root';
  if(req.headers.accountname !== 'root' && req.headers.accountname !== req.body.accountName) {
    return sendErrorJSON(res, 'Not authorized to update this account', 403);
  }

  Account.findOne({peerId: req.headers.peerid, accountName: req.body.accountName}, function(err, account){
    if(err) {
      return sendErrorJSON(res, err, 500);
    }
    if(!account) {
      return sendErrorJSON(res, 'Account "' + req.body.accountName + '" does not exist', 400);
    }

    // set active group of account
    if(typeof req.body.activeGroup === 'string') {
      if(req.body.activeGroup) {
        account.activeGroup = req.body.activeGroup;
      } else {
        account.activeGroup = undefined;
      }
    }

    // Only non-root users may be disabled
    if(req.body.accountName !== 'root') {
      if(req.body.enabled === 'true' && account.enabled === 'false') {
        // Enable account in DB
        account.enabled = true;

        // Start listening for this account
        Group.find({owner: account._id}, function(err, groups) {
          for(var i = 0; i < groups.length; i++) {
            distort_ipfs.subscribe(groups[i].name, groups[i].subgroupIndex);
          }
        });
      } else if(req.body.enabled === 'false' && account.enabled === 'true') {
        // Disable account in DB
        account.enabled = false;

        // Stop listening for this account
        Group.find({owner: account._id}, function(err, groups) {
          for(var i = 0; i < groups.length; i++) {
            distort_ipfs.unsubscribe(groups[i].name, groups[i].subgroupIndex);
          }
        });
      }
    }

    // Allow updating of password by submitting new authentication-token
    if(req.body.authToken && typeof req.body.authToken === "string") {
      account.tokenHash = sjcl.codec.base64.fromBits(sjcl.hash.sha256.hash(req.body.authToken));
    }

    account.save(function(err, account) {
      if(err) {
        return sendErrorJSON(res, err, 500);
      }
      res.json(account);
    });
  });
}


// Retrieve account peers
exports.fetchPeers = function(req, res) {
  Account.findOne({peerId: req.headers.peerid, accountName: req.headers.accountname}, function(err, acct) {
    if(err) {
      return sendErrorJSON(res, err, 500);
    }

    Peer
      .find({owner: acct._id})
      .populate({path: 'cert', select: 'groups'})
      .select('accountName peerId nickname cert')
      .exec(function(err, peers) {
      if(err) {
        return sendErrorJSON(res, err, 500);
      }

      res.json(peers);
    })
  });
};

// Retrieve account peers
exports.addPeer = function(req, res) {
  if(!req.body.peerId) {
    sendErrorJSON(res, "Requires IPFS-ID of peer to add", 400);
  }

  Account.findOne({peerId: req.headers.peerid, accountName: req.headers.accountname}, function(err, acct) {
    if(err) {
      return sendErrorJSON(res, err, 500);
    }

    var newPeer = {
      nickname: req.body.nickname,
      owner: acct._id,
      peerId: req.body.peerId,
      accountName: req.body.accountName || 'root'
    };

    // Ensure account does not already exist
    Peer.findOne({peerId: newPeer.peerId, accountName: newPeer.accountName, owner: newPeer.owner}, function(err, peer) {
      if(err) {
        return sendErrorJSON(res, err, 500);
      }

      // If peer exists, use this to update nickname. Otherwise create new peer
      if(peer) {
        peer.nickname = newPeer.nickname;
      } else {
        peer = new Peer(newPeer);
      }

      Cert.findOne({peerId: peer.peerId, accountName: peer.accountName, status: 'valid'}, function(err, cert) {
        if(err) {
          return sendErrorJSON(res, err, 500);
        }
        if(!cert) {
          return sendErrorJSON(res, "Cannot add a peer until discovery of their certificate. Please wait for their next routine certificate posti", 400);
        }

        // If there exists a certificate for this user already, assign to this peer
        if(cert) {
          peer.cert = cert._id;
        }

        peer.save(function(err) {
          if(err) {
            return sendErrorJSON(res, err, 500);
          }
          peer.populate('cert', function(err) {
            if(err) {
              return sendErrorJSON(res, err, 500);
            }
            res.json(peer);
          });
        });
      });
    })
  });
};

// Remove a peer from account's list
exports.removePeer = function(req, res) {
  if(!req.body.peerID) {
    sendErrorJSON(res, "Requires IPFS-ID of peer to remove", 400);
  }

  Account.findOne({peerId: req.headers.peerid, accountName: req.headers.accountname}, function(err, acct) {
    if(err) {
      return sendErrorJSON(res, err, 500);
    }

    const accountName = req.body.accountName || 'root';
    Peer.findOne({owner: acct._id, peerId: req.body.peerId, accountName: accountName}, function(err, peer) {
      if(err) {
        return sendErrorJSON(res, err, 500);
      }

      const peerFullTitle = req.body.peerId + (!!req.body.accountName ? ':' + accountName : "");
      if(!peer) {
        return sendErrorJSON(res, 'Account does not have peer: ' + peerFullTitle, 400);
      }

      Peer.remove({owner: acct._id, peerId: req.body.peerId, accountName: accountName}, function(err, delStats) {
        if(err) {
          return sendErrorJSON(res, err, 500);
        }

        res.json({message: 'Successfully removed peer: ' + peerFullTitle});
      });
    });
  });
};
