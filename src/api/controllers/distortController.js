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

// List all (sub)group memberships through their groups and subgroup paths
exports.listGroups = function(req, res) {
  Group.find({peerId: req.headers.peerid, accountName: req.headers.accountname})
    .select('name subgroupIndex height lastReadIndex')
    .exec(function(err, groups) {
    if(err) {
      res.status(500);
      return res.send(err);
    }
    res.json(groups);
  });
};

// Add topic and given subgroup path to account's groups
exports.addGroup = function(req, res) {
  const subI = parseInt(req.body.subgroupIndex);
  if(isNaN(subI) || subI < 0) {
    res.status(400);
    return res.send("subgroupIndex must be a non-negative integer");
  }

  var reqGroup = {};
  reqGroup.name = req.body.name;
  reqGroup.peerId = req.headers.peerid;
  reqGroup.accountName = req.headers.accountname;
  Group.find(reqGroup, function(err, groups) {
    if(err) {
      res.status(500);
      return res.send(err);
    }
    if(groups.length > 0) {
      res.status(400);
      return res.send('This group is already subscribed to');
    }

    reqGroup.subgroupIndex = subI;
    try {
      distort_ipfs.subscribe(reqGroup.name, subI);
    } catch(err) {
      res.status(500);
      return res.send(err);
    }

    var newGroup = new Group(reqGroup);
    newGroup.save(function(err, group) {
      if(err) {
        res.status(500);
        return res.send(err);
      }

      // If none active, set new group to be active group
      Account
        .findOne({peerId: req.headers.peerid, accountName: req.headers.accountname})
        .select('activeGroup cert')
        .exec(function(err, acct) {
        if(err) {
          res.status(500);
          return res.send(err);
        }

        if(!acct.activeGroup) {
          acct.activeGroup = group._id;
          acct.save();
        }

        // Include group in certificate
        Cert.findById(acct.cert, function(err, cert) {
          if(err) {
            res.status(500);
            return res.send(err);
          }
          cert.groups.push(group.name + ":" + group.subgroupIndex);
          cert.save(function(err) {
            if(err) {
              res.status(500);
              return res.send(err);
            }

            // Succeeded all the trials, group is fully added
            res.json(group);
          });
        });
      });
    });
  });
};

// Retrieve messages for the specified group
exports.readMissedMessages = function(req, res) {
  Group.findOne({name: req.params.groupName, peerId: req.headers.peerid, accountName: req.headers.accountname}, function(err, group) {
    if(!group) {
      res.status(400);
      return res.send('Authorized account is not a member of group: ' + req.params.groupName);
    }

    InMessage
      .find({'groupId': group._id})
      .where('index').gt(group.lastReadIndex)
      .sort('-index')
      .select('cipher dateReceived from index message verified')
      .exec(function(err, inMsgs) {

      if(err) {
        res.status(500);
        return res.send(err);
      }
      OutMessage
        .find({'groupId': group._id})
        .where('index').gt(group.lastReadIndex)
        .populate({path: 'to', select: 'accountName peerId'})
        .sort('-index')
        .select('index lastStatusChange message status to')
        .exec(function(err, outMsgs) {

        if(err) {
          res.status(500);
          return res.send(err);
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
    if(!group) {
      res.status(400);
      return res.send('Authorized account is not a member of group: ' + req.params.groupName);
    }

    // Must include a 'to' object
    if(!req.body.toPeerId && !req.body.toNickname) {
      res.status(400);
      return res.send('Must include "toPeerId" or "toNickname" in request body');
    }

    // Must include a non-empty message
    if(!req.body.message || typeof req.body.message !== "string") {
      res.status(400);
      return res.send('Must include a non-empty string "message" in request body');
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
        Peer.findOne({nickname: req.body.toNickname}, function(err, peer) {
          if(err) {
            reject('Could not find cert for nickname: ' + err);
          } else {
            resolve(peer.cert);
          }
        });
      }
    }).catch(function(err) {
      res.status(400);
      return res.send(err);
    }).then(function(toCertId) {
      // If posting to this account and group soon, assume it to be the active group
      try {
        updateActiveGroup(req.headers.peerid, group._id, req.headers.accountname);
      } catch(err) {
        res.status(500);
        return res.send(err);
      }

      var outMessage = new OutMessage({
        groupId: group._id,
        index: group.height++,
        message: req.body.message,
        to: toCertId
      });
      outMessage.save(function(err, msg) {
        if(err) {
          res.status(500);
          return res.send(err);
        }
        if(DEBUG) {
          console.log('Saved enqueued message to DB at index: ' + msg.index);
        }

        group.save(function(err) {
          if(err) {
            res.status(500);
            return res.send(err);
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
    if(!group || err) {
      res.status(400);
      return res.send('Authorized account is not a member of group: ' + req.params.groupName);
    }

    Group.remove({'name': req.params.groupName, 'peerId': req.headers.peerid, 'accountName': req.headers.accountname}, function(err, delStats) {
      if(err) {
        res.status(500);
        return res.send(err);
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
          res.status(500);
          return res.send(err);
        }
        Cert.findById(acct.cert, function(err, cert) {
          if(err) {
            res.status(500);
            return res.send(err);
          }

          const couple = group.name + ":" + group.subgroupIndex;
          for(var i = 0; i < cert.groups.length; i++) {
            if(couple === cert.groups[i]) {
              cert.groups.splice(i, 1);
            }
          }
          cert.save(function(err) {
            if(err) {
              res.status(500);
              return res.send(err);
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
    if(!group) {
      res.status(400);
      return res.send('Authorized account is not a member of group: ' + req.params.groupName);
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
        res.status(500);
        return res.send(err);
      }
      OutMessage
        .find({'groupId': group._id})
        .where('index').gte(indexStart).lte(indexEnd)
        .populate({path: 'to', select: 'accountName peerId'})
        .sort('-index')
        .select('index lastStatusChange message status to')
        .exec(function(err, outMsgs) {

        if(err) {
          res.status(500);
          return res.send(err);
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
      res.status(500);
      return res.send(err);
    }

    res.json(acct);
  });
};
