"use strict";

var mongoose = require('mongoose'),
  distort_ipfs = require('../../distort-ipfs'),
  Account = mongoose.model('Accounts'),
  Cert = mongoose.model('Certs'),
  Group = mongoose.model('Groups'),
  InMessage = mongoose.model('InMessages'),
  OutMessage = mongoose.model('OutMessages'),
  Peer = mongoose.model('Peers');

const DEBUG = true;

// Ensure the correct active Group-ID in DB
function updateActiveGroupId(peerId, groupId, accountName) {
  Account.findOne({'peerId': peerId, 'accountName': accountName || 'root'}, function(err, account) {
    if(err) {
      throw err;
    }

    if(account.activeGroupId != groupId) {
      account.activeGroupId = groupId;
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
      res.json(group);
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
      .populate({path: 'from', select: 'accountName peerId'})
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
    if(!req.body.to) {
      res.status(400);
      return res.send('Must include a "to" object in request');
    }

    // Determine if we have the certificate of the intended peer
    var certPromise = new Promise(function(resolve, reject) {
      // Can specify peer by friendly nickname or explicit peer-ID
      if(req.body.to.peerId) {
        Cert.findOne({accountName: req.body.to.accountName || 'root', peerId: req.body.to.peerId, status: 'valid'}, function(err, cert) {
          if(err) {
            reject('Could not find cert for peer-ID: ' + err);
          } else {
            resolve(cert._id);
          }
        });
      } else {
        Peer.findOne({nickname: req.body.to.nickname}, function(err, peer) {
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
        updateActiveGroupId(req.headers.peerid, group._id, req.headers.accountname);
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

        group.save();
        res.json({message: 'Enqueued: ' + msg.message});
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
      res.json({message: 'Successfully left group: ' + req.params.groupName});
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
      .populate({path: 'from', select: 'accountName peerId'})
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
