"use strict";

var mongoose = require('mongoose'),
  distort_ipfs = require('../../distort-ipfs'),
  config = require('../../config'),
  Account = mongoose.model('Accounts'),
  Cert = mongoose.model('Certs'),
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
  return res.json({error: err});
}

// List all (sub)group memberships through their groups and subgroup paths
exports.listGroups = function(req, res) {
  Group.find({peerId: req.headers.peerid, accountName: req.headers.accountname})
    .select('name subgroupIndex height lastReadIndex')
    .exec(function(err, groups) {
    if(err) {
      return sendErrorJSON(res, err, 500);
    }

    res.json(groups);
  });
};

// Add topic and given subgroup path to account's groups
exports.addGroup = function(req, res) {
  const subI = parseInt(req.body.subgroupIndex);
  if(isNaN(subI) || subI < 0) {
    return sendErrorJSON(res, "subgroupIndex must be a non-negative integer", 400);
  }

  var reqGroup = {};
  reqGroup.name = req.body.name;
  reqGroup.peerId = req.headers.peerid;
  reqGroup.accountName = req.headers.accountname;
  Group.findOne(reqGroup, function(err, group) {
    if(err) {
      return sendErrorJSON(res, err, 500);
    }

    if(group) {
      return sendErrorJSON(res, 'This group is already subscribed to', 400);
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
      Cert.findById(acct.cert, function(err, cert) {
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
};

// Retrieve messages for the specified group
exports.readMissedMessages = function(req, res) {
  Group.findOne({name: req.params.groupName, peerId: req.headers.peerid, accountName: req.headers.accountname}, function(err, group) {
    if(!group) {
      return sendErrorJSON(res, 'Authorized account is not a member of group: ' + req.params.groupName, 400);
    }

    InMessage
      .find({'groupId': group._id})
      .where('index').gt(group.lastReadIndex)
      .sort('-index')
      .select('cipher dateReceived from index message verified')
      .exec(function(err, inMsgs) {
      if(err) {
        return sendErrorJSON(res, err, 500);
      }

      OutMessage
        .find({'groupId': group._id})
        .where('index').gt(group.lastReadIndex)
        .populate({path: 'to', select: 'accountName peerId'})
        .sort('-index')
        .select('index lastStatusChange message status to')
        .exec(function(err, outMsgs) {
        if(err) {
          return sendErrorJSON(res, err, 500);
        }

        // Update last read message
        group.lastReadIndex = Math.max(inMsgs.length ? inMsgs[0].index : -1, outMsgs.length ? outMsgs[0].index : -1, group.lastReadIndex);
        group.save();

        res.json({'in': inMsgs, 'out': outMsgs});
      });
    });
  })
};

// Enqueue a message to the specified group
exports.postMessage = function(req, res) {
  Group.findOne({name: req.params.groupName, peerId: req.headers.peerid, accountName: req.headers.accountname}, function(err, group) {
    if(err) {
      return sendErrorJSON(res, err, 500);
    }

    if(!group) {
      return sendErrorJSON(res, 'Authorized account is not a member of group: ' + req.params.groupName, 400);
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
          if(err) {
            reject('Could not find cert for peer-ID: ' + err);
          } else {
            resolve(cert._id);
          }
        });
      } else {
        Account.findOne({peerId: req.headers.peerid, accountName: req.headers.accountname}, function(err, account) {
          if(err) {
            return sendErrorJSON(res, err, 500);
          }

          Peer.findOne({owner: account._id, nickname: req.body.toNickname}, function(err, peer) {
            if(err) {
              reject('Could not find cert for nickname: ' + err);
            } else {
              resolve(peer.cert);
            }
          });
        });
      }
    }).catch(function(err) {
      return sendErrorJSON(res, err, 400);
    }).then(function(toCertId) {
      // If posting to this account and group soon, assume it to be the active group
      try {
        updateActiveGroup(req.headers.peerid, group._id, req.headers.accountname);
      } catch(err) {
        return sendErrorJSON(res, err, 500);
      }

      var outMessage = new OutMessage({
        groupId: group._id,
        index: group.height++,
        message: req.body.message,
        to: toCertId
      });
      outMessage.save(function(err, msg) {
        if(err) {
          return sendErrorJSON(res, err, 500);
        }

        if(DEBUG) {
          console.log('Saved enqueued message to DB at index: ' + msg.index);
        }

        group.save(function(err) {
          if(err) {
            return sendErrorJSON(res, err, 500);
          }

          // Only send success after all transactions succeed
          res.json(msg);
        });
      });
    });
  });
};

// Stop streaming on the specified group
exports.leaveGroup = function(req, res) {
  Group.findOne({'name': req.params.groupName, 'peerId': req.headers.peerid, 'accountName': req.headers.accountname}, function(err, group) {
    if(err) {
      return sendErrorJSON(res, err, 500);
    }

    if(!group) {
      return sendErrorJSON(res, 'Authorized account is not a member of group: ' + req.params.groupName, 400);
    }

    Group.remove({'name': req.params.groupName, 'peerId': req.headers.peerid, 'accountName': req.headers.accountname}, function(err, delStats) {
      if(err) {
        return sendErrorJSON(res, err, 500);
      }

      try {
        distort_ipfs.unsubscribe(topic, group.subgroupIndex);
      } catch(err) {
        console.log(err);
      }

      // Include group in certificate
      Account
        .findOne({peerId: req.headers.peerid, accountName: req.headers.accountname})
        .select('cert')
        .exec(function(err, acct) {
        if(err) {
          return sendErrorJSON(res, err, 500);
        }

        Cert.findById(acct.cert, function(err, cert) {
          if(err) {
            return sendErrorJSON(res, err, 500);
          }

          const couple = group.name + ":" + group.subgroupIndex;
          for(var i = 0; i < cert.groups.length; i++) {
            if(couple === cert.groups[i]) {
              cert.groups.splice(i, 1);
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
exports.readMessagesInRange = function(req, res) {
  Group.findOne({name: req.params.groupName, peerId: req.headers.peerid, accountName: req.headers.accountname}, function(err, group) {
    if(err) {
      return sendErrorJSON(res, err, 500);
    }

    if(!group) {
      return sendErrorJSON(res, 'Authorized account is not a member of group: ' + req.params.groupName, 400);
    }

    const indexStart = parseInt(req.params.indexStart);
    const indexEnd = req.params.indexEnd ? parseInt(req.params.indexEnd) : group.height-1;

    InMessage
      .find({'groupId': group._id})
      .where('index').gte(indexStart).lte(indexEnd)
      .sort('-index')
      .select('cipher dateReceived from index message verified')
      .exec(function(err, inMsgs) {
      if(err) {
        return sendErrorJSON(res, err, 500);
      }

      OutMessage
        .find({'groupId': group._id})
        .where('index').gte(indexStart).lte(indexEnd)
        .populate({path: 'to', select: 'accountName peerId'})
        .sort('-index')
        .select('index lastStatusChange message status to')
        .exec(function(err, outMsgs) {
        if(err) {
          return sendErrorJSON(res, err, 500);
        }

        // Update last read message (if needed)
        group.lastReadIndex = Math.max(inMsgs.length ? inMsgs[0].index : -1, outMsgs.length ? outMsgs[0].index : -1, group.lastReadIndex);
        group.save();

        res.json({'in': inMsgs, 'out': outMsgs});
      });
    });
  })
};


// Retrieve account information
exports.fetchAccount = function(req, res) {
  Account
    .findOne({peerId: req.headers.peerid, accountName: req.headers.accountname})
    .populate({path: 'activeGroup', select: 'name subgroupIndex height lastReadIndex'})
    .select('accountName activeGroup enabled peerId')
    .exec(function(err, acct) {
    if(err) {
      return sendErrorJSON(res, err, 500);
    }

    res.json(acct);
  });
};


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

        // If there exists a certificate for this user already, assign to this peer
        if(cert) {
          peer.cert = cert._id;
        }

        peer.save(function(err) {
          if(err) {
            return sendErrorJSON(res, err, 500);
          }

          res.json(peer)
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
        return sendErrorJSON(res, 'Authorized account does not have peer: ' + peerFullTitle, 400);
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
